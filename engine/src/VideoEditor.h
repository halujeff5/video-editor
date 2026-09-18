#pragma once

#include <string>
#include <emscripten/val.h>

struct SpliceResult {
    bool valid;
    double firstStart;
    double firstEnd;
    double secondStart;
    double secondEnd;
};

struct RangeSpliceResult {
    bool valid;
    bool hasBefore;
    bool hasAfter;
    double beforeStart;
    double beforeEnd;
    double selectionStart;
    double selectionEnd;
    double afterStart;
    double afterEnd;
};

struct SpotifyTrackRecord {
    std::string id;
    std::string name;
    std::string artists;
    double duration;
    std::string spotifyUrl;
};

SpliceResult spliceClip(double sourceStart, double sourceEnd, double splitTime);
RangeSpliceResult spliceRange(
    double sourceStart,
    double sourceEnd,
    double selectionStart,
    double selectionEnd
);
void pushUndoState(const std::string& state);
bool canUndo();
std::string popUndoState();
void clearUndoHistory();
double timelinePlayheadPercent(
    double totalDuration,
    double elapsedBeforeClip,
    double clipPlaybackTime
);
double timelineTimeFromPercent(double totalDuration, double percent);
int saveSpotifyTrack(
    const std::string& id,
    const std::string& name,
    const std::string& artists,
    double duration,
    const std::string& spotifyUrl
);
int spotifyTrackCount();
SpotifyTrackRecord getSpotifyTrack(int index);
int saveAudioAsset(const std::string& name, const emscripten::val& bytes);
int audioAssetSize(int index);
