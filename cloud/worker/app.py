"""Private Cloud Run CPU worker. Cloud Run IAM must reject unauthenticated ingress."""
import hashlib
import os
import re
import tempfile
import time
import unicodedata
import uuid
from datetime import datetime,timedelta,timezone
from pathlib import Path
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel,ConfigDict
from google.cloud import firestore,storage
from google.cloud.firestore_v1.vector import Vector
from media import probe,scene_ranges,sampled_frames,transcribe,render_timeline
from providers import describe,embed,download_approved,EMBEDDING_MODEL

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
MAX_ATTEMPTS=3
PIPELINE_VERSION='cpu-mix-v1'
class Canceled(Exception):pass
class LeaseBusy(Exception):pass
class PermanentError(Exception):pass
class Payload(BaseModel):
    model_config=ConfigDict(extra='forbid')
    workspaceId:str
    jobId:str


def valid_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',value):
        raise PermanentError('Invalid identifier')
    return value


def tokens(text):
    words=re.findall(r'[^\W_]+',unicodedata.normalize('NFKC',text).lower(),re.UNICODE)
    result=[]
    for word in words:
        if any('\u3400'<=c<='\u9fff' for c in word):
            result.extend(word[i:i+2] for i in range(len(word)-1))
            result.append(word[-1:])
        else:result.append(word)
    return list(dict.fromkeys(result))[:100]


class Repository:
    def __init__(self,db,workspace,job_id):
        self.db=db
        self.workspace=db.collection('workspaces').document(valid_id(workspace))
        self.ref=self.workspace.collection('exportJobs').document(valid_id(job_id))
        self.lease=uuid.uuid4().hex
        self.last_check=0
        self.started=time.monotonic()
        self.approvals={}
    def claim(self):
        @firestore.transactional
        def transaction(tx):
            snapshot=self.ref.get(transaction=tx)
            if not snapshot.exists:raise PermanentError('Job not found')
            job=snapshot.to_dict()
            if job.get('pipeline')!=PIPELINE_VERSION:raise PermanentError('Foreign job pipeline')
            if job['status'] in ['succeeded','failed','canceled']:return None
            if job.get('status')=='processing' and job.get('leaseUntil',datetime.min.replace(tzinfo=timezone.utc))>datetime.now(timezone.utc):raise LeaseBusy()
            tx.update(self.ref,{'status':'processing','leaseToken':self.lease,'leaseUntil':datetime.now(timezone.utc)+timedelta(seconds=1800),'attempts':job.get('attempts',0)+1})
            return {**job,'attempts':job.get('attempts',0)+1}
        return transaction(self.db.transaction())
    def checkpoint(self,force=False):
        if time.monotonic()-self.started>1500:raise TimeoutError('Worker deadline exceeded')
        if not force and time.monotonic()-self.last_check<10:return
        self.last_check=time.monotonic()
        data=self.ref.get().to_dict()
        if not data or data.get('leaseToken')!=self.lease:raise Canceled('Lease replaced')
        member=self.workspace.collection('members').document(data['createdBy']).get().to_dict()
        if not member or member.get('active') is not True or member.get('role') not in ['owner','editor']:raise Canceled('Workspace access revoked')
        if data.get('cancelRequested'):raise Canceled('Customer canceled the job')
    def finish(self,job,status,metrics,output=None,error_code=None):
        @firestore.transactional
        def transaction(tx):
            current=self.ref.get(transaction=tx).to_dict()
            if not current or current.get('leaseToken')!=self.lease or current.get('status')!='processing':return False
            quota=self.db.document(job['quotaPath'])
            budget=quota.get(transaction=tx).to_dict() or {}
            usage_ref=self.workspace.collection('aiUsageRecords').document(self.ref.id)
            previous=usage_ref.get(transaction=tx).to_dict() or {}
            member=self.workspace.collection('members').document(job['createdBy']).get(transaction=tx).to_dict()
            decisions={asset:self.workspace.collection('assetApprovals').document(asset).get(transaction=tx).to_dict() for asset in self.approvals}
            final_status=status
            if final_status=='succeeded' and (current.get('cancelRequested') or not member or not member.get('active') or member.get('role') not in ['owner','editor'] or any(not decisions[asset] or not decisions[asset].get('approved') or decisions[asset].get('revision')!=revision for asset,revision in self.approvals.items())):
                final_status='canceled'
            cumulative={**previous.get('metrics',{})}
            for key,value in metrics.items():
                if isinstance(value,(int,float)) and not isinstance(value,bool):cumulative[key]=cumulative.get(key,0)+value
                else:cumulative[key]=value
            settled=final_status in ['succeeded','failed','canceled']
            if final_status in ['failed','canceled']:
                tx.update(quota,{'reserved':max(0,budget.get('reserved',0)-job['reservedUnits'])})
            change={'status':final_status,'approvalRevisions':self.approvals,'leaseUntil':datetime.now(timezone.utc),'updatedAt':firestore.SERVER_TIMESTAMP}
            if output and final_status=='succeeded':change['outputPath']=output
            if error_code:change['errorCode']=error_code
            tx.update(self.ref,change)
            provider='google-gemini' if job['kind']=='analyze' else 'ffmpeg'
            model=os.environ.get('GEMINI_MODEL') if job['kind']=='analyze' else 'libx264-720p-v1'
            tx.create(usage_ref.collection('attempts').document(self.lease),{'uid':job['createdBy'],'jobId':self.ref.id,'attempt':job['attempts'],'provider':provider,'model':model,'embeddingModel':EMBEDDING_MODEL if job['kind']=='analyze' else None,'asrModelRevision':os.environ.get('WHISPER_MODEL_REVISION'),'metrics':metrics,'status':final_status,'createdAt':firestore.SERVER_TIMESTAMP})
            tx.set(self.workspace.collection('aiUsageRecords').document(self.ref.id),{'provider':provider,'model':model,'embeddingModel':EMBEDDING_MODEL if job['kind']=='analyze' else None,'status':final_status,'metrics':cumulative,'actualCostUsd':None,'estimatedCostUsd':None,'costStatus':'unpriced','reservedUnits':job['reservedUnits'],'refundedUnits':job['reservedUnits'] if final_status in ['failed','canceled'] else 0,'settled':settled,'updatedAt':firestore.SERVER_TIMESTAMP},merge=True)
            tx.create(self.workspace.collection('auditLogs').document(),{'uid':job['createdBy'],'jobId':self.ref.id,'action':f'job.{final_status}','createdAt':firestore.SERVER_TIMESTAMP})
            return final_status
        return transaction(self.db.transaction())


def get_blob(bucket,path,workspace,destination,generation=None,max_bytes=500*1024*1024):
    if not isinstance(path,str) or not path.startswith(f'workspaces/{workspace}/') or '..' in path.split('/'):
        raise PermanentError('Object outside workspace')
    blob=bucket.blob(path)
    blob.reload()
    if not blob.size or blob.size>min(500*1024*1024,max_bytes):raise PermanentError('Object exceeds size limit')
    if generation is not None and str(blob.generation)!=str(generation):raise PermanentError('Original object generation changed')
    blob.download_to_filename(str(destination),if_generation_match=blob.generation)
    return blob


def upload_private(bucket, object_path, file, content_type, exclusive=False):
    blob=bucket.blob(object_path)
    # Only derived objects get customTime. Lifecycle policy never deletes originals by accident.
    blob.custom_time=datetime.now(timezone.utc)
    arguments={'content_type':content_type}
    if exclusive:arguments['if_generation_match']=0
    blob.upload_from_filename(str(file),**arguments)
    return blob


def analyze(repo,job,bucket,directory,metrics):
    video_id=valid_id(job['targetId'])
    video_ref=repo.workspace.collection('videos').document(video_id)
    video=video_ref.get().to_dict()
    if not video or not video.get('consent',{}).get('gemini'):raise PermanentError('Cloud consent missing')
    path=Path(directory)/'original'
    blob=bucket.blob(video['storagePath'])
    blob.reload()
    if blob.size!=video['sizeBytes']:raise PermanentError('Original size changed')
    model=os.environ.get('GEMINI_MODEL')
    if not model:raise PermanentError('Select and configure a Gemini analysis model before deployment')
    cache_key=hashlib.sha256(f'{blob.generation}:{PIPELINE_VERSION}:{model}:{EMBEDDING_MODEL}'.encode()).hexdigest()
    if video.get('status')=='ready' and video.get('analysisKey')==cache_key:
        metrics['analysisCacheHit']=True
        return None
    get_blob(bucket,video['storagePath'],repo.workspace.id,path,generation=blob.generation)
    metadata=probe(path)
    scenes=scene_ranges(path,metadata['durationMs'],repo.checkpoint)
    repo.checkpoint(force=True)
    transcript=transcribe(path,os.environ.get('WHISPER_MODEL_DIR'),repo.checkpoint) if metadata['audio'] else []
    frames=sampled_frames(path,metadata['durationMs'],directory)
    records=[]
    for index,frame in enumerate(frames):
        repo.checkpoint()
        description,usage=describe(frame['file'],model)
        metrics['geminiCalls']+=1
        metrics['inputTokens']+=usage.get('promptTokenCount',0)
        metrics['outputTokens']+=usage.get('candidatesTokenCount',0)
        records.append({'kind':'visual','startMs':frame['timeMs'],'endMs':min(metadata['durationMs'],frame['timeMs']+1000),'text':description,'model':model})
        # Private, generation-keyed object; no download tokens or public ACL.
        upload_private(bucket,f'workspaces/{repo.workspace.id}/thumbnails/{video_id}/{cache_key}-{index}.jpg',frame['file'],'image/jpeg')
    records.extend({'kind':'transcript',**segment} for segment in transcript)
    if len(records)>508:raise PermanentError('Too many analysis segments')
    metrics['inputCharacters']=sum(len(record['text']) for record in records)
    documents=[]
    for index,record in enumerate(records):
        repo.checkpoint()
        vector=embed(record['text'])
        metrics['embeddingCalls']+=1
        documents.append((f'{video_id}-{cache_key}-{index}',{**record,'workspaceId':repo.workspace.id,'videoId':video_id,'analysisKey':cache_key,'model':EMBEDDING_MODEL,'descriptionModel':record.get('model'),'embedding':Vector(vector),'keywords':tokens(record['text'])}))
    # Publish small documents in bounded batches. Each generation stays separate until marked ready.
    for start in range(0,len(documents),100):
        batch=repo.db.batch()
        for key,data in documents[start:start+100]:batch.set(repo.workspace.collection('videoEmbeddings').document(key),data)
        batch.commit()
    for name,items in [('scenes',scenes),('transcripts',transcript),('events',[r for r in records if r['kind']=='visual'])]:
        for start in range(0,len(items),100):
            batch=repo.db.batch()
            for index,item in enumerate(items[start:start+100],start):batch.set(video_ref.collection(name).document(f'{cache_key}-{index}'),{**item,'analysisKey':cache_key})
            batch.commit()
    repo.checkpoint(force=True)
    @firestore.transactional
    def publish(tx):
        current=repo.ref.get(transaction=tx).to_dict()
        if not current or current.get('leaseToken')!=repo.lease or current.get('cancelRequested'):raise Canceled('Analysis was canceled')
        tx.update(video_ref,{'status':'ready','durationMs':metadata['durationMs'],'analysisKey':cache_key,'sourceGeneration':str(blob.generation),'analysisModel':model,'updatedAt':firestore.SERVER_TIMESTAMP})
    publish(repo.db.transaction())
    return None


def render(repo,job,bucket,directory,metrics):
    version=repo.workspace.collection('timelineVersions').document(valid_id(job['targetId'])).get().to_dict()
    if not version or version.get('workspaceId')!=repo.workspace.id:raise PermanentError('Timeline missing')
    if any(clip.get('assetType')=='broll' for clip in version.get('clips',[])) and os.environ.get('STOCK_TERMS_REVIEWED')!='true':raise PermanentError('Stock policy review is required')
    assets={}
    total_bytes=0
    approvals={}
    def check_approvals():
        repo.checkpoint(force=True)
        for asset_id,revision in approvals.items():
            decision=repo.workspace.collection('assetApprovals').document(asset_id).get().to_dict()
            if not decision or not decision.get('approved') or not decision.get('usageRightsConfirmed') or decision.get('revision')!=revision:raise Canceled('Asset approval changed')
    for clip in version.get('clips',[]):
        repo.checkpoint()
        kind,asset_id=clip.get('assetType'),valid_id(clip.get('assetId'))
        key=(kind,asset_id)
        if key in assets:continue
        target=Path(directory)/f'asset-{len(assets)}'
        if kind=='original':
            video=repo.workspace.collection('videos').document(asset_id).get().to_dict()
            if not video or video.get('status')!='ready':raise PermanentError('Original not ready')
            get_blob(bucket,video['storagePath'],repo.workspace.id,target,generation=video.get('sourceGeneration'),max_bytes=1024**3-total_bytes)
        elif kind=='broll':
            if os.environ.get('STOCK_TERMS_REVIEWED')!='true':raise PermanentError('Review stock API and license terms before enabling stock rendering')
            decision=repo.workspace.collection('assetApprovals').document(asset_id).get().to_dict()
            suggestion=repo.workspace.collection('brollSuggestions').document(asset_id).get().to_dict()
            if not decision or not suggestion or not decision.get('approved') or not decision.get('licenseReviewed') or not decision.get('usageRightsConfirmed'):raise PermanentError('Stock approval missing')
            if decision.get('sourceUrl')!=suggestion.get('sourceUrl') or decision.get('termsVersion')!=suggestion.get('termsVersion'):raise PermanentError('Asset provenance changed')
            approvals[asset_id]=decision['revision']
            repo.approvals[asset_id]=decision['revision']
            download_approved(suggestion['downloadUrl'],target,repo.checkpoint,max_bytes=1024**3-total_bytes)
            probe(target)
            check_approvals()
            upload_private(bucket,f'workspaces/{repo.workspace.id}/approvedBroll/{asset_id}/source.mp4',target,'video/mp4')
        else:raise PermanentError('Invalid timeline asset')
        total_bytes+=target.stat().st_size
        if total_bytes>1024**3:raise PermanentError('Combined input assets exceed 1 GiB')
        assets[key]=target
    check_approvals()
    output=Path(directory)/'export.mp4'
    metadata=render_timeline(version,assets,directory,output,repo.checkpoint)
    check_approvals()
    output_path=f'workspaces/{repo.workspace.id}/exports/{repo.ref.id}/{repo.lease}.mp4'
    upload_private(bucket,output_path,output,'video/mp4',exclusive=True)
    # Verify approval again before advertising the export as complete.
    check_approvals()
    metrics['generatedVideoSeconds']=metadata['durationMs']/1000
    metrics['outputBytes']=output.stat().st_size
    return output_path


@app.post('/jobs')
def process_job(payload:Payload):
    # This endpoint has no public auth fallback: deployment MUST use --no-allow-unauthenticated.
    valid_id(payload.workspaceId);valid_id(payload.jobId)
    db=firestore.Client()
    repo=Repository(db,payload.workspaceId,payload.jobId)
    try:job=repo.claim()
    except LeaseBusy:raise HTTPException(503,'Job lease is still active')
    except PermanentError:raise HTTPException(404,'Job not found')
    if not job:return {'status':'already-settled'}
    metrics={'geminiCalls':0,'embeddingCalls':0,'inputTokens':0,'outputTokens':0,'inputCharacters':0,'workerWallSeconds':0,'gpuSeconds':0}
    try:
        if job['attempts']>MAX_ATTEMPTS:raise PermanentError('Retry limit exceeded')
        repo.checkpoint(force=True)
        bucket=storage.Client().bucket(os.environ['STUDIO_BUCKET'])
        with tempfile.TemporaryDirectory(prefix='jsox-job-') as directory:
            if job['kind']=='analyze':output=analyze(repo,job,bucket,directory,metrics)
            elif job['kind']=='render':output=render(repo,job,bucket,directory,metrics)
            else:raise PermanentError('Unsupported job type')
        metrics['workerWallSeconds']=round(time.monotonic()-repo.started,3)
        status=repo.finish(job,'succeeded',metrics,output)
        if not status:raise HTTPException(409,'Job lease replaced')
        return {'status':status}
    except Canceled:
        repo.finish(job,'canceled',metrics,error_code='canceled')
        return {'status':'canceled'}
    except HTTPException:raise
    except Exception as error:
        metrics['workerWallSeconds']=round(time.monotonic()-repo.started,3)
        terminal=isinstance(error,(PermanentError,ValueError)) or job['attempts']>=MAX_ATTEMPTS
        repo.finish(job,'failed' if terminal else 'queued',metrics,error_code='processing-failed')
        if terminal:return {'status':'failed'}
        raise HTTPException(503,'Retryable processing error')
