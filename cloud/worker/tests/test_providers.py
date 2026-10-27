import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch, MagicMock
from providers import start_veo_generation, poll_veo_operation, download_veo_video


def _response(status_code=200, json_value=None, chunks=None):
    response=MagicMock()
    response.status_code=status_code
    response.json.return_value=json_value
    if chunks is not None:
        response.iter_content.return_value=chunks
    response.__enter__.return_value=response
    response.__exit__.return_value=False
    return response


class VeoProviderTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{"GEMINI_API_KEY":"test-key"});self.env.start()
    def tearDown(self):
        self.env.stop()
    def test_start_rejects_blank_prompt(self):
        with self.assertRaises(ValueError):start_veo_generation("  ","veo-3.1-lite-generate-preview")
    def test_start_rejects_unsupported_aspect_ratio(self):
        with self.assertRaises(ValueError):start_veo_generation("a cat","veo-3.1-lite-generate-preview","1:1")
    @patch("providers.requests.post")
    def test_start_returns_operation_name(self, post):
        post.return_value=_response(json_value={"name":"models/veo-3.1-lite-generate-preview/operations/abc123"})
        self.assertEqual(start_veo_generation("a cat","veo-3.1-lite-generate-preview"),"models/veo-3.1-lite-generate-preview/operations/abc123")
    @patch("providers.requests.post")
    def test_start_rejects_malformed_operation_name(self, post):
        post.return_value=_response(json_value={"name":"not-an-operation"})
        with self.assertRaises(RuntimeError):start_veo_generation("a cat","veo-3.1-lite-generate-preview")
    @patch("providers.requests.get")
    def test_poll_returns_none_while_pending(self, get):
        get.return_value=_response(json_value={"done":False})
        self.assertIsNone(poll_veo_operation("models/veo-3.1-lite-generate-preview/operations/abc123"))
    @patch("providers.requests.get")
    def test_poll_raises_on_operation_error(self, get):
        get.return_value=_response(json_value={"done":True,"error":{"message":"quota exceeded"}})
        with self.assertRaises(RuntimeError):poll_veo_operation("models/veo-3.1-lite-generate-preview/operations/abc123")
    @patch("providers.requests.get")
    def test_poll_returns_video_uri(self, get):
        uri="https://generativelanguage.googleapis.com/v1beta/files/abc:download"
        get.return_value=_response(json_value={"done":True,"response":{"generateVideoResponse":{"generatedSamples":[{"video":{"uri":uri}}]}}})
        self.assertEqual(poll_veo_operation("models/veo-3.1-lite-generate-preview/operations/abc123"),uri)
    @patch("providers.requests.get")
    def test_poll_rejects_untrusted_uri(self, get):
        get.return_value=_response(json_value={"done":True,"response":{"generateVideoResponse":{"generatedSamples":[{"video":{"uri":"https://evil.example/video.mp4"}}]}}})
        with self.assertRaises(RuntimeError):poll_veo_operation("models/veo-3.1-lite-generate-preview/operations/abc123")
    @patch("providers.requests.get")
    def test_download_writes_file(self, get):
        get.return_value=_response(chunks=[b"abc",b"def"])
        with TemporaryDirectory() as directory:
            target=Path(directory)/"video.mp4"
            download_veo_video("https://generativelanguage.googleapis.com/v1beta/files/abc:download",target)
            self.assertEqual(target.read_bytes(),b"abcdef")
    @patch("providers.requests.get")
    def test_download_enforces_size_limit(self, get):
        get.return_value=_response(chunks=[b"x"*10])
        with TemporaryDirectory() as directory:
            target=Path(directory)/"video.mp4"
            with self.assertRaises(ValueError):download_veo_video("https://generativelanguage.googleapis.com/v1beta/files/abc:download",target,max_bytes=5)


if __name__=="__main__":
    unittest.main()
