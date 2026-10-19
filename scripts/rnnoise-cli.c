/* Jsox wrapper for Xiph RNNoise. Input/output: little endian signed 16-bit mono PCM, 48 kHz.
 * RNNoise copyright and BSD notices are distributed alongside this executable.
 * Two frames of algorithm lookahead are drained and removed; output has exactly N samples.
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <wchar.h>
#include <math.h>
#include "rnnoise.h"
#define FRAME 480
#define DELAY 960
int wmain(int argc, wchar_t **argv) {
  if (argc == 2 && !wcscmp(argv[1], L"--version")) {
    puts("jsox-rnnoise 1; upstream 70f1d256acd4b34a572f999a05c87bf00b67730d; 48000 Hz; latency 960 samples"); return 0;
  }
  int raw = argc == 4 && !wcscmp(argv[3], L"--raw-delay");
  if (argc != 3 && !raw) { fputs("usage: rnnoise-cli input.s16le output.s16le [--raw-delay]\n", stderr); return 2; }
  if (!wcscmp(argv[1], argv[2])) return 2;
  FILE *input = _wfopen(argv[1], L"rb");
  if (!input) return 3;
  _fseeki64(input, 0, SEEK_END); long long bytes = _ftelli64(input); rewind(input);
  if (bytes < 0 || bytes % 2) { fclose(input); return 4; }
  long long samples = bytes / 2, written = 0, emitted = 0;
  FILE *output = _wfopen(argv[2], L"wb");
  DenoiseState *state = rnnoise_create(NULL);
  if (!output || !state) { if(output) fclose(output); fclose(input); return 5; }
  long long frames = (samples + FRAME - 1) / FRAME + DELAY / FRAME;
  for (long long f = 0; f < frames; ++f) {
    int16_t pcm[FRAME] = {0}, result[FRAME]; float x[FRAME], y[FRAME];
    size_t got = fread(pcm, sizeof(int16_t), FRAME, input);
    if (ferror(input)) { fclose(input); fclose(output); rnnoise_destroy(state); return 6; }
    for(int i=0;i<FRAME;++i) x[i] = pcm[i];
    rnnoise_process_frame(state,y,x);
    int count = 0;
    for(int i=0;i<FRAME;++i,++emitted) {
      if ((!raw && emitted < DELAY) || written >= samples + (raw ? DELAY : 0)) continue;
      float value = fmaxf(-32768.f, fminf(32767.f,y[i]));
      result[count++] = (int16_t)lrintf(value); ++written;
    }
    if(count && fwrite(result,sizeof(int16_t),count,output) != (size_t)count) { fclose(input); fclose(output); rnnoise_destroy(state); return 7; }
    (void)got;
  }
  rnnoise_destroy(state); fclose(input);
  if(fclose(output)) return 8;
  if(written != samples + (raw ? DELAY : 0)) return 9;
  fprintf(stderr,"{\"samples\":%lld,\"sampleRate\":48000,\"latencySamples\":960}\n",samples);
  return 0;
}
