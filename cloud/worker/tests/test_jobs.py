"""Job state-machine tests with a fake Firestore transport, not a Rules/emulator substitute."""
import copy
import unittest
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
from app import Repository,Canceled,PermanentError,analysis_cache_key

class Snapshot:
    def __init__(self,data):self.value=copy.deepcopy(data);self.exists=data is not None
    def to_dict(self):return copy.deepcopy(self.value)
class Document:
    def __init__(self,db,path):self.db=db;self.path=path;self.id=path.split('/')[-1]
    def collection(self,name):return Collection(self.db,self.path+'/'+name)
    def get(self,transaction=None):return Snapshot(self.db.data.get(self.path))
class Collection:
    def __init__(self,db,path):self.db=db;self.path=path;self.id=path.split('/')[-1]
    def document(self,name=None):return Document(self.db,self.path+'/'+(name or 'audit-'+str(len(self.db.data))))
class Transaction:
    def __init__(self,db):self.db=db
    def update(self,ref,value):self.db.data[ref.path].update(value)
    def set(self,ref,value,merge=False):self.db.data[ref.path]={**(self.db.data.get(ref.path,{}) if merge else {}),**value}
    def create(self,ref,value):self.db.data[ref.path]=value
class Database:
    def __init__(self):self.data={}
    def collection(self,name):return Collection(self,name)
    def document(self,path):return Document(self,path)
    def transaction(self):return Transaction(self)

class JobTests(unittest.TestCase):
    def setUp(self):
        self.mock=patch('app.firestore.transactional',lambda fn:fn);self.mock.start()
        self.db=Database();self.repo=Repository(self.db,'ws','job')
        self.db.data['workspaces/ws/members/alice']={'role':'owner','active':True}
        self.db.data['workspaces/ws/_quotas/day']={'reserved':10}
        self.db.data['workspaces/ws/exportJobs/job']={'kind':'analyze','pipeline':'cpu-mix-v1','workspaceId':'ws','createdBy':'alice','targetId':'video','status':'queued','attempts':0,'quotaPath':'workspaces/ws/_quotas/day','reservedUnits':10}
        self.db.data['workspaces/ws/videos/video']={'workspaceId':'ws','status':'uploading','analysisJobId':'job'}
    def tearDown(self):self.mock.stop()
    def test_cancel_refunds_once_and_duplicate_delivery_is_settled(self):
        job=self.repo.claim();self.db.data[self.repo.ref.path]['cancelRequested']=True
        with self.assertRaises(Canceled):self.repo.checkpoint(force=True)
        self.assertTrue(self.repo.finish(job,'canceled',{}))
        self.assertFalse(self.repo.finish(job,'canceled',{}))
        self.assertEqual(self.db.data[job['quotaPath']]['reserved'],0)
        self.assertIsNone(self.repo.claim())
    def test_stale_lease_cannot_publish_or_refund(self):
        job=self.repo.claim();self.db.data[self.repo.ref.path]['leaseToken']='new-owner'
        self.assertFalse(self.repo.finish(job,'succeeded',{},'export.mp4'))
        self.assertEqual(self.db.data[job['quotaPath']]['reserved'],10)
        self.assertNotIn('outputPath',self.db.data[self.repo.ref.path])
    def test_metrics_accumulate_across_retry_without_duplicate_reservation(self):
        job=self.repo.claim();self.repo.finish(job,'queued',{'inputTokens':2})
        next_repo=Repository(self.db,'ws','job');second=next_repo.claim()
        self.assertEqual(second['attempts'],2)
        next_repo.finish(second,'succeeded',{'inputTokens':3})
        self.assertEqual(self.db.data['workspaces/ws/aiUsageRecords/job']['metrics']['inputTokens'],5)
        self.assertEqual(self.db.data[job['quotaPath']]['reserved'],10)
    def test_approval_revocation_at_commit_cancels_export(self):
        job=self.repo.claim();self.repo.approvals={'asset':1}
        self.db.data['workspaces/ws/assetApprovals/asset']={'approved':False,'revision':2}
        self.repo.finish(job,'succeeded',{},'workspaces/ws/exports/export.mp4')
        state=self.db.data[self.repo.ref.path]
        self.assertEqual(state['status'],'canceled');self.assertNotIn('outputPath',state)
    def test_revoked_membership_cannot_finish_export(self):
        job=self.repo.claim();self.db.data['workspaces/ws/members/alice']['active']=False
        self.repo.finish(job,'succeeded',{},'export.mp4')
        self.assertEqual(self.db.data[self.repo.ref.path]['status'],'canceled')
    def test_foreign_pipeline_and_workspace_are_not_claimed(self):
        original=copy.deepcopy(self.db.data[self.repo.ref.path])
        for field,value in [('pipeline','other'),('workspaceId','other'),('kind','unsupported')]:
            self.db.data[self.repo.ref.path]={**original,field:value}
            before=copy.deepcopy(self.db.data[self.repo.ref.path])
            with self.assertRaises(PermanentError):self.repo.claim()
            self.assertEqual(self.db.data[self.repo.ref.path],before)
    def test_cancel_at_commit_does_not_publish_analysis(self):
        job=self.repo.claim()
        self.repo.analysis_publish={'status':'ready','analysisKey':'new-generation'}
        self.db.data[self.repo.ref.path]['cancelRequested']=True
        self.assertEqual(self.repo.finish(job,'succeeded',{}),'canceled')
        self.assertEqual(self.db.data['workspaces/ws/videos/video']['status'],'uploading')
        self.assertNotIn('analysisKey',self.db.data['workspaces/ws/videos/video'])
    def test_success_commits_analysis_with_job_settlement(self):
        job=self.repo.claim()
        self.repo.analysis_publish={'status':'ready','analysisKey':'new-generation','analysisCacheKey':'cache-key'}
        self.assertEqual(self.repo.finish(job,'succeeded',{}),'succeeded')
        self.assertEqual(self.db.data['workspaces/ws/videos/video']['analysisKey'],'new-generation')
        self.assertEqual(self.db.data[self.repo.ref.path]['status'],'succeeded')
    def test_superseded_analysis_cannot_replace_newer_results(self):
        job=self.repo.claim()
        self.repo.analysis_publish={'status':'ready','analysisKey':'old-generation'}
        self.db.data['workspaces/ws/videos/video'].update({'analysisJobId':'new-job','analysisKey':'new-generation','status':'ready'})
        with self.assertRaises(Canceled):self.repo.checkpoint(force=True)
        self.assertEqual(self.repo.finish(job,'succeeded',{}),'canceled')
        self.assertEqual(self.db.data['workspaces/ws/videos/video']['analysisKey'],'new-generation')
    def test_model_revision_and_source_generation_invalidate_analysis_cache(self):
        original=analysis_cache_key(1,'gemini-model','whisper-revision-a')
        self.assertEqual(original,analysis_cache_key('1','gemini-model','whisper-revision-a'))
        for values in [(2,'gemini-model','whisper-revision-a'),(1,'new-gemini-model','whisper-revision-a'),(1,'gemini-model','whisper-revision-b')]:
            self.assertNotEqual(original,analysis_cache_key(*values))

if __name__=='__main__':unittest.main()
