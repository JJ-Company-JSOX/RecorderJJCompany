"""Job state-machine tests with a fake Firestore transport, not a Rules/emulator substitute."""
import copy
import unittest
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
from app import Repository,Canceled

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

if __name__=='__main__':unittest.main()
