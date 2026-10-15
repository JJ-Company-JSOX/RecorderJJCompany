import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from media import FFMPEG,probe,render_timeline,sampled_frames,scene_ranges,validate_timeline
from providers import allowed_stock_url,download_approved

class MediaTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.root=Path(self.directory.name)
        self.source=self.root/'source.mkv'
        subprocess.run([FFMPEG,'-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=320x180:r=10:duration=3','-c:v','ffv1','-threads','2',str(self.source)],check=True)
    def tearDown(self):self.directory.cleanup()
    def test_real_cpu_render_normalizes_and_adds_silent_audio(self):
        output=self.root/'output.mp4'
        value={'width':1280,'height':720,'fps':30,'clips':[{'assetType':'original','assetId':'one','startMs':0,'endMs':1000},{'assetType':'broll','assetId':'two','startMs':1000,'endMs':2000}]}
        result=render_timeline(value,{('original','one'):self.source,('broll','two'):self.source},self.root,output)
        self.assertTrue(result['audio'])
        self.assertLess(abs(result['durationMs']-2000),150)
        self.assertGreater(output.stat().st_size,1000)
    def test_real_opencv_sampling_and_scene_detection(self):
        images=sampled_frames(self.source,3000,self.root,3)
        self.assertEqual([f['timeMs'] for f in images],[500,1500,2500])
        self.assertTrue(all(f['file'].read_bytes().startswith(b'\xff\xd8') for f in images))
        scenes=scene_ranges(self.source,3000)
        self.assertEqual(scenes[0]['startMs'],0)
        self.assertLessEqual(scenes[-1]['endMs'],3000)
    def test_invalid_clip_is_rejected_and_cancellation_stops_render(self):
        value={'width':1280,'height':720,'fps':30,'clips':[{'assetType':'original','assetId':'one','startMs':0,'endMs':4000}]}
        with self.assertRaises(ValueError):render_timeline(value,{('original','one'):self.source},self.root,self.root/'invalid.mp4')
        value['clips'][0]['endMs']=1000
        def cancel():raise InterruptedError('test canceled')
        with self.assertRaises(InterruptedError):render_timeline(value,{('original','one'):self.source},self.root,self.root/'canceled.mp4',cancel)
    def test_stock_downloader_refuses_arbitrary_hosts_and_redirects(self):
        self.assertFalse(allowed_stock_url('http://127.0.0.1/x'))
        self.assertFalse(allowed_stock_url('https://pexels.com.evil.invalid/x'))
        self.assertFalse(allowed_stock_url('https://videos.pexels.com:8443/x'))
        self.assertTrue(allowed_stock_url('https://videos.pexels.com/video-files/1.mp4'))
        with patch('providers.requests.get') as get:
            get.return_value.__enter__.return_value.status_code=302
            with self.assertRaises(RuntimeError):download_approved('https://videos.pexels.com/a.mp4',self.root/'a')
            self.assertFalse((self.root/'a').exists())

class TimelineContractTests(unittest.TestCase):
    def test_unsupported_effects_are_rejected_before_media_is_opened(self):
        value={'width':1280,'height':720,'fps':30,'clips':[{'assetType':'original','assetId':'one','startMs':0,'endMs':1000}]}
        for extra in [{'zoomRegions':[]},{'audioTracks':[]},{'background':'blue'}]:
            with self.assertRaisesRegex(ValueError,'Unsupported timeline fields'):
                render_timeline({**value,**extra},{},Path('/unused'),Path('/unused/output'))
        for clip in [None,[],{**value['clips'][0],'speed':2}]:
            with self.assertRaises(ValueError):validate_timeline({**value,'clips':[clip]})
    def test_stored_metadata_is_allowed_but_bool_ranges_and_urls_are_rejected(self):
        clip={'assetType':'original','assetId':'one','startMs':0,'endMs':1000}
        value={'width':1280,'height':720,'fps':30,'clips':[clip],'workspaceId':'ws','createdBy':'alice','createdAt':{},'fingerprint':'hash','projectId':'project'}
        validate_timeline(value,stored=True)
        for invalid in [{'startMs':True},{'endMs':600001},{'assetId':'https://example.invalid/video'}]:
            with self.assertRaises(ValueError):validate_timeline({**value,'clips':[{**clip,**invalid}]},stored=True)

if __name__=='__main__':unittest.main()
