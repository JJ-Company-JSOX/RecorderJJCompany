"""CPU media primitives. No cloud credentials, shell strings or model downloads."""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

FFMPEG = os.environ.get("FFMPEG_BINARY", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BINARY", "ffprobe")


def run_ffmpeg(arguments, checkpoint=lambda: None, timeout=1200):
    with open(os.devnull, "wb") as output:
        process = subprocess.Popen([FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin", *arguments], stdout=output, stderr=subprocess.PIPE)
        started = time.monotonic()
        try:
            while process.poll() is None:
                checkpoint()
                if time.monotonic() - started > timeout:
                    raise TimeoutError("FFmpeg processing deadline exceeded")
                try:
                    _, error = process.communicate(timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    continue
            else:
                _, error = process.communicate()
            if process.returncode:
                raise ValueError("FFmpeg could not process this media")
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


def probe(file):
    output = subprocess.run([FFPROBE, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", str(file)], check=True, capture_output=True, timeout=30).stdout
    data = json.loads(output)
    duration = int(float(data["format"]["duration"]) * 1000)
    videos = [s for s in data.get("streams", []) if s.get("codec_type") == "video"]
    if not videos or not 0 < duration <= 600_000 or videos[0].get("width", 0) * videos[0].get("height", 0) > 3840 * 2160:
        raise ValueError("CPU preview supports videos up to 10 minutes and 4K")
    return {"durationMs": duration, "audio": any(s.get("codec_type") == "audio" for s in data["streams"])}


def _scene_ranges(file, duration_ms):
    from scenedetect import open_video, SceneManager, ContentDetector
    video = open_video(str(file))
    manager = SceneManager()
    manager.add_detector(ContentDetector(threshold=27))
    try:
        manager.detect_scenes(video, show_progress=False)
        scenes = manager.get_scene_list(start_in_scene=True)
        return [{"startMs": int(a.get_seconds()*1000), "endMs": min(duration_ms, int(b.get_seconds()*1000))} for a,b in scenes][:500] or [{"startMs":0,"endMs":duration_ms}]
    finally:
        video.reset()


def scene_ranges(file, duration_ms, checkpoint=lambda: None):
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--scenes', str(file), str(duration_ms)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    started=time.monotonic()
    try:
        while True:
            checkpoint()
            if time.monotonic()-started>900:raise TimeoutError('Scene detection timed out')
            try:
                output,_=process.communicate(timeout=1)
                break
            except subprocess.TimeoutExpired:continue
        if process.returncode or len(output)>100000:raise ValueError('Scene detection failed')
        return json.loads(output)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


def sampled_frames(file, duration_ms, directory, count=8):
    import cv2
    capture = cv2.VideoCapture(str(file))
    frames = []
    try:
        for i in range(min(count, max(1, duration_ms//1000))):
            at = int((i+0.5)*duration_ms/min(count, max(1,duration_ms//1000)))
            capture.set(cv2.CAP_PROP_POS_MSEC, at)
            success, image = capture.read()
            if not success:
                raise ValueError("Cannot extract an analysis frame")
            height, width = image.shape[:2]
            scale = min(640/width, 360/height, 1)
            image = cv2.resize(image, (max(1,int(width*scale)),max(1,int(height*scale))))
            target = Path(directory)/f"frame-{i}.jpg"
            if not cv2.imwrite(str(target), image, [cv2.IMWRITE_JPEG_QUALITY,80]):
                raise ValueError("Cannot write a thumbnail")
            frames.append({"timeMs":at,"file":target})
        return frames
    finally:
        capture.release()


def transcribe(file, model_dir, checkpoint=lambda: None):
    from faster_whisper import WhisperModel
    if not model_dir or not Path(model_dir).is_dir():
        raise ValueError("Provision an approved local faster-whisper model before analysis")
    model = WhisperModel(model_dir, device="cpu", compute_type="int8", local_files_only=True, cpu_threads=4, num_workers=1)
    segments, info = model.transcribe(str(file), vad_filter=True, beam_size=1)
    result=[]
    for segment in segments:
        checkpoint()
        if len(result)>=500:
            raise ValueError("Transcript exceeds preview segment limit")
        result.append({"startMs":int(segment.start*1000),"endMs":int(segment.end*1000),"text":segment.text[:5000],"language":info.language})
    return result


def validate_timeline(timeline, stored=False):
    fields={'width','height','fps','clips'}
    if stored:fields.update({'workspaceId','projectId','createdBy','createdAt','fingerprint'})
    if not isinstance(timeline,dict) or set(timeline)-fields:raise ValueError('Unsupported timeline fields')
    clips=timeline.get('clips')
    if not isinstance(clips,list) or not 0<len(clips)<=100 or timeline.get("width")!=1280 or timeline.get("height")!=720 or timeline.get("fps")!=30:
        raise ValueError("Unsupported timeline")
    total=0
    for clip in clips:
        if not isinstance(clip,dict) or set(clip)!={'assetType','assetId','startMs','endMs'}:raise ValueError('Unsupported clip fields')
        if clip['assetType'] not in ['original','broll'] or not isinstance(clip['assetId'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',clip['assetId']):raise ValueError('Invalid timeline asset')
        start,end=clip['startMs'],clip['endMs']
        if type(start) is not int or type(end) is not int or start<0 or end<=start or end>600000:raise ValueError('Invalid clip range')
        total+=end-start
    if total>600000:raise ValueError('Export too long')


def render_timeline(timeline, assets, directory, output, checkpoint=lambda: None):
    """A bounded CPU cut/concatenate renderer; PixiJS desktop effects are not represented here."""
    validate_timeline(timeline,stored=True)
    clips=timeline['clips']
    parts=[]
    total=0
    for index, clip in enumerate(clips):
        checkpoint()
        start,end=clip["startMs"],clip["endMs"]
        if not isinstance(start,int) or not isinstance(end,int) or start<0 or end<=start:
            raise ValueError("Invalid clip range")
        total+=end-start
        if total>600000:
            raise ValueError("Export too long")
        file=assets[(clip["assetType"],clip["assetId"])]
        metadata=probe(file)
        if end>metadata["durationMs"]+50:
            raise ValueError("Clip exceeds media duration")
        target=Path(directory)/f"part-{index}.mp4"
        args=["-y","-protocol_whitelist","file,pipe","-ss",str(start/1000),"-i",str(file)]
        if not metadata["audio"]:
            args += ["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]
        args += ["-t",str((end-start)/1000),"-map","0:v:0","-map","0:a:0" if metadata["audio"] else "1:a:0","-vf","scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30","-c:v","libx264","-preset","veryfast","-crf","23","-maxrate","6M","-bufsize","12M","-threads","2","-c:a","aac","-ar","48000","-ac","2","-shortest",str(target)]
        run_ffmpeg(args,checkpoint)
        parts.append(target)
    # Only worker-generated filenames enter the concat manifest, never user strings.
    listing=Path(directory)/"parts.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts))
    run_ffmpeg(["-y","-protocol_whitelist","file,pipe","-f","concat","-safe","1","-i",str(listing),"-c","copy","-movflags","+faststart",str(output)],checkpoint)
    return probe(output)

if __name__ == '__main__' and len(sys.argv)==4 and sys.argv[1]=='--scenes':
    print(json.dumps(_scene_ranges(sys.argv[2],int(sys.argv[3]))))
