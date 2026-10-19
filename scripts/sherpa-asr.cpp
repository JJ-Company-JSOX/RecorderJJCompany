// Jsox helper. Build machine compiles this; customers need no compiler or Python.
// C API declarations: sherpa-onnx Apache-2.0. This integration follows repository AGPL.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sherpa-onnx/c-api/c-api.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

template <class T> T bind(HMODULE module, const char* name) {
  auto ptr = GetProcAddress(module, name);
  if (!ptr) throw std::runtime_error(std::string("Missing C API symbol: ") + name);
  return reinterpret_cast<T>(ptr);
}
std::string utf8(const wchar_t* text) {
  int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, nullptr, 0, nullptr, nullptr);
  if (length < 1) throw std::runtime_error("Invalid Unicode argument");
  std::string result(length, 0);
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, text, -1, result.data(), length, nullptr, nullptr);
  result.pop_back();
  return result;
}
std::vector<float> readWav(const wchar_t* file) {
  std::ifstream input(std::filesystem::path(file), std::ios::binary);
  std::vector<char> bytes((std::istreambuf_iterator<char>(input)), {});
  if (bytes.size() < 44 || bytes.size() > 2'000'000 || memcmp(bytes.data(), "RIFF", 4) || memcmp(bytes.data() + 8, "WAVE", 4))
    throw std::runtime_error("Expected a bounded 16kHz mono PCM16 WAV (maximum 30 seconds)");
  auto u16 = [&](size_t p) { uint16_t v; memcpy(&v, bytes.data() + p, 2); return v; };
  auto u32 = [&](size_t p) { uint32_t v; memcpy(&v, bytes.data() + p, 4); return v; };
  bool pcm = false;
  size_t start = 0, size = 0;
  for (size_t p = 12; p + 8 <= bytes.size();) {
    auto count = u32(p + 4);
    if (count > bytes.size() - p - 8) throw std::runtime_error("Truncated WAV chunk");
    if (!memcmp(bytes.data() + p, "fmt ", 4)) {
      if (count < 16) throw std::runtime_error("Invalid WAV format");
      pcm = u16(p + 8) == 1 && u16(p + 10) == 1 && u32(p + 12) == 16000 && u16(p + 22) == 16;
    } else if (!memcmp(bytes.data() + p, "data", 4)) { start = p + 8; size = count; }
    p += 8 + count + (count & 1);
  }
  if (!pcm || !start || !size || size % 2 || size / 2 > 480000) throw std::runtime_error("Unsupported WAV audio format or duration");
  std::vector<float> samples(size / 2);
  for (size_t i = 0; i < samples.size(); ++i) { int16_t v; memcpy(&v, bytes.data() + start + i * 2, 2); samples[i] = v / 32768.f; }
  return samples;
}
int wmain(int argc, wchar_t** argv) {
  if (argc != 8) { std::cerr << "Usage: jsox-sherpa-asr DLL ENCODER DECODER TOKENS WAV LANGUAGE THREADS\n"; return 2; }
  HMODULE library = nullptr;
  try {
    auto samples = readWav(argv[5]);
    auto dll = std::filesystem::absolute(argv[1]);
    library = LoadLibraryExW(dll.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    if (!library) throw std::runtime_error("Cannot load bundled Sherpa C API DLL");
#define API(name) auto name = bind<decltype(&::name)>(library, #name)
    API(SherpaOnnxCreateOfflineRecognizer); API(SherpaOnnxDestroyOfflineRecognizer);
    API(SherpaOnnxCreateOfflineStream); API(SherpaOnnxDestroyOfflineStream);
    API(SherpaOnnxAcceptWaveformOffline); API(SherpaOnnxDecodeOfflineStream);
    API(SherpaOnnxGetOfflineStreamResultAsJson); API(SherpaOnnxDestroyOfflineStreamResultJson);
    auto encoder = utf8(argv[2]), decoder = utf8(argv[3]), tokens = utf8(argv[4]), language = utf8(argv[6]);
    int threads = std::stoi(utf8(argv[7]));
    if (threads < 1 || threads > 4) throw std::runtime_error("Invalid thread count");
    SherpaOnnxOfflineRecognizerConfig config{};
    config.feat_config.sample_rate = 16000; config.feat_config.feature_dim = 80;
    config.model_config.whisper.encoder = encoder.c_str();
    config.model_config.whisper.decoder = decoder.c_str();
    config.model_config.whisper.language = language.c_str();
    config.model_config.whisper.task = "transcribe";
    config.model_config.whisper.tail_paddings = -1;
    config.model_config.whisper.enable_segment_timestamps = 1;
    config.model_config.tokens = tokens.c_str(); config.model_config.num_threads = threads;
    config.model_config.provider = "cpu"; config.decoding_method = "greedy_search";
    auto recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
    if (!recognizer) throw std::runtime_error("Could not initialize Sherpa Whisper base model");
    auto stream = SherpaOnnxCreateOfflineStream(recognizer);
    if (!stream) { SherpaOnnxDestroyOfflineRecognizer(recognizer); throw std::runtime_error("Could not create ASR stream"); }
    SherpaOnnxAcceptWaveformOffline(stream, 16000, samples.data(), static_cast<int32_t>(samples.size()));
    SherpaOnnxDecodeOfflineStream(recognizer, stream);
    auto result = SherpaOnnxGetOfflineStreamResultAsJson(stream);
    if (result) { std::cout << result << "\n"; SherpaOnnxDestroyOfflineStreamResultJson(result); }
    SherpaOnnxDestroyOfflineStream(stream); SherpaOnnxDestroyOfflineRecognizer(recognizer);
    FreeLibrary(library); library = nullptr;
    if (!result) throw std::runtime_error("No recognition result");
    return 0;
  } catch (const std::exception& error) { std::cerr << error.what() << "\n"; if (library) FreeLibrary(library); return 1; }
}
