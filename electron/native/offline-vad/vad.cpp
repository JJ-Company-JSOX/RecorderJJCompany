// Jsox CPU VAD helper. Silero inference is supplied by the pinned sherpa-onnx C API.
// No media is modified, no network is used, and stdout contains only source sample ranges.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <fstream>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include "sherpa-onnx/c-api/c-api.h"

static uint32_t u32(const unsigned char* p) {
  return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
static uint16_t u16(const unsigned char* p) { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
static std::string utf8(const std::wstring& s) {
  const int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), int(s.size()), nullptr, 0, nullptr, nullptr);
  if (n <= 0) throw std::runtime_error("Invalid Unicode path");
  std::string result(n, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), int(s.size()), result.data(), n, nullptr, nullptr);
  return result;
}
template<typename T> static T symbol(HMODULE library, const char* name) {
  const auto value = GetProcAddress(library, name);
  if (!value) throw std::runtime_error("Incomplete bundled sherpa VAD runtime");
  return reinterpret_cast<T>(value);
}
int wmain(int argc, wchar_t** argv) {
  try {
    if (argc != 4) throw std::runtime_error("Usage: jsox-vad.exe model.onnx mono16k.wav sherpa-onnx-c-api.dll");
    const std::wstring model = argv[1], wav = argv[2], dll = argv[3];
    const auto libraryDeleter = [](void* value) { FreeLibrary(static_cast<HMODULE>(value)); };
    // Preload the exact sibling ORT, even if another application installed a DLL
    // of the same name in a system search directory.
    const auto ortPath = std::filesystem::path(dll).parent_path() / L"onnxruntime.dll";
    HMODULE ort = LoadLibraryExW(ortPath.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if (!ort) throw std::runtime_error("Could not load bundled ONNX Runtime");
    const auto releaseOrt = std::unique_ptr<void, decltype(libraryDeleter)>(ort, libraryDeleter);
    HMODULE library = LoadLibraryExW(dll.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if (!library) throw std::runtime_error("Could not load complete bundled sherpa runtime");
    const auto releaseLibrary = std::unique_ptr<void, decltype(libraryDeleter)>(library, libraryDeleter);
#define VAD_API(name) const auto name = symbol<decltype(&SherpaOnnx##name)>(library, "SherpaOnnx" #name)
    VAD_API(CreateVoiceActivityDetector);
    VAD_API(DestroyVoiceActivityDetector);
    VAD_API(VoiceActivityDetectorAcceptWaveform);
    VAD_API(VoiceActivityDetectorEmpty);
    VAD_API(VoiceActivityDetectorFront);
    VAD_API(VoiceActivityDetectorPop);
    VAD_API(DestroySpeechSegment);
    VAD_API(VoiceActivityDetectorFlush);
#undef VAD_API
    std::ifstream input(std::filesystem::path(wav), std::ios::binary);
    if (!input) throw std::runtime_error("Cannot read analysis WAV");
    unsigned char riff[12];
    if (!input.read(reinterpret_cast<char*>(riff), 12) || std::string(reinterpret_cast<char*>(riff),4) != "RIFF" || std::string(reinterpret_cast<char*>(riff+8),4) != "WAVE")
      throw std::runtime_error("Expected RIFF WAV");
    bool formatOk = false, foundData = false;
    uint32_t dataBytes = 0;
    for (int chunks = 0; chunks < 64; ++chunks) {
      unsigned char chunk[8];
      if (!input.read(reinterpret_cast<char*>(chunk),8)) break;
      const std::string tag(reinterpret_cast<char*>(chunk),4);
      const uint32_t size = u32(chunk+4);
      if (tag == "data") { dataBytes=size; foundData=true; break; }
      if (size > 16*1024*1024) throw std::runtime_error("Unexpected WAV metadata size");
      if (tag == "fmt ") {
        if (size < 16 || size > 1024) throw std::runtime_error("Invalid WAV format");
        std::vector<unsigned char> format(size);
        if (!input.read(reinterpret_cast<char*>(format.data()),size)) throw std::runtime_error("Truncated WAV format");
        formatOk = u16(format.data()) == 1 && u16(format.data()+2) == 1 && u32(format.data()+4) == 16000 && u16(format.data()+12) == 2 && u16(format.data()+14) == 16;
        if (size & 1) input.ignore(1);
      } else input.ignore(size + (size & 1));
    }
    if (!foundData || !formatOk || !dataBytes || dataBytes % 2 || dataBytes > 16000u*2u*600u)
      throw std::runtime_error("VAD requires mono 16 kHz PCM16 audio up to 10 minutes");
    const int32_t total = int32_t(dataBytes/2);
    const std::string modelUtf8 = utf8(model);
    SherpaOnnxVadModelConfig config{};
    config.silero_vad.model = modelUtf8.c_str();
    config.silero_vad.threshold = 0.35f;
    config.silero_vad.min_silence_duration = 0.35f;
    config.silero_vad.min_speech_duration = 0.10f;
    config.silero_vad.window_size = 512;
    config.silero_vad.max_speech_duration = 600.0f;
    config.sample_rate = 16000;
    config.num_threads = 1;
    config.provider = "cpu";
    const auto detector = CreateVoiceActivityDetector(&config, 601.0f);
    if (!detector) throw std::runtime_error("Silero VAD initialization failed");
    const auto releaseDetector = std::unique_ptr<const SherpaOnnxVoiceActivityDetector, decltype(DestroyVoiceActivityDetector)>(detector, DestroyVoiceActivityDetector);
    std::vector<std::pair<int32_t,int32_t>> ranges;
    auto drain = [&]() {
      while (!VoiceActivityDetectorEmpty(detector)) {
        const auto segment = VoiceActivityDetectorFront(detector);
        if (!segment) throw std::runtime_error("Invalid VAD segment");
        const int64_t end = int64_t(segment->start) + segment->n;
        const int32_t start = std::clamp(segment->start,0,total);
        const int32_t finish = int32_t(std::clamp<int64_t>(end,0,total));
        DestroySpeechSegment(segment);
        VoiceActivityDetectorPop(detector);
        if (finish > start) ranges.emplace_back(start,finish);
        if (ranges.size() > 20000) throw std::runtime_error("Excessive VAD segments");
      }
    };
    for (int32_t offset=0; offset<total; offset+=512) {
      const int count = std::min(512,total-offset);
      unsigned char pcm[1024]{};
      if (!input.read(reinterpret_cast<char*>(pcm), count*2)) throw std::runtime_error("Truncated WAV audio");
      float samples[512]{};
      for (int i=0; i<count; ++i) samples[i]=static_cast<int16_t>(u16(pcm+i*2))/32768.0f;
      VoiceActivityDetectorAcceptWaveform(detector,samples,512);
      drain();
    }
    VoiceActivityDetectorFlush(detector);
    drain();
    std::cout << "{\"version\":1,\"sampleRate\":16000,\"durationSamples\":" << total << ",\"segments\":[";
    for (size_t i=0;i<ranges.size();++i) {
      if (i) std::cout << ',';
      std::cout << "{\"startSample\":" << ranges[i].first << ",\"endSample\":" << ranges[i].second << '}';
    }
    std::cout << "]}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
