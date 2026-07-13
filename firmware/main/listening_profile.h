#ifndef LISTENING_PROFILE_H
#define LISTENING_PROFILE_H

#include <cstdint>

static constexpr int64_t kVadSilenceTimeoutUs = 2000000;  // 2s

enum ListeningProfile {
    kListeningProfileVoice,
    kListeningProfileRaw,
};

enum ListenProfileParseWarning {
    kListenProfileParseWarningNone,
    kListenProfileParseWarningNonString,
    kListenProfileParseWarningUnknown,
};

struct ListenProfileParseResult {
    ListeningProfile profile = kListeningProfileVoice;
    ListenProfileParseWarning warning = kListenProfileParseWarningNone;
};

ListenProfileParseResult ParseListenProfileField(bool profile_present,
                                                 bool profile_is_string,
                                                 const char* profile_value);
ListeningProfile ListeningProfileAfterStop(ListeningProfile profile);
bool ShouldUseVadSilenceStop(ListeningProfile profile);

#endif  // LISTENING_PROFILE_H
