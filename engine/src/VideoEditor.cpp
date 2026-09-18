#include "VideoEditor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace {
std::vector<std::string> undoHistory;
std::vector<SpotifyTrackRecord> spotifyTracks;

struct AudioAsset {
    std::string name;
    std::vector<unsigned char> bytes;
};

std::vector<AudioAsset> audioAssets;
}

SpliceResult spliceClip(double sourceStart, double sourceEnd, double splitTime) {
    constexpr double minimumSegmentDuration = 0.05;
    const bool finiteInputs = std::isfinite(sourceStart) &&
                              std::isfinite(sourceEnd) &&
                              std::isfinite(splitTime);
    const bool validRange = sourceEnd > sourceStart;
    const bool splitInsideRange = splitTime - sourceStart >= minimumSegmentDuration &&
                                  sourceEnd - splitTime >= minimumSegmentDuration;

    if (!finiteInputs || !validRange || !splitInsideRange) {
        return {false, sourceStart, sourceEnd, sourceEnd, sourceEnd};
    }

    return {true, sourceStart, splitTime, splitTime, sourceEnd};
}

RangeSpliceResult spliceRange(
    double sourceStart,
    double sourceEnd,
    double selectionStart,
    double selectionEnd
) {
    constexpr double minimumSegmentDuration = 0.05;
    const bool finiteInputs = std::isfinite(sourceStart) &&
                              std::isfinite(sourceEnd) &&
                              std::isfinite(selectionStart) &&
                              std::isfinite(selectionEnd);
    const bool selectionInsideSource = selectionStart >= sourceStart &&
                                       selectionEnd <= sourceEnd;
    const bool validSelection = selectionEnd - selectionStart >= minimumSegmentDuration;

    if (!finiteInputs || sourceEnd <= sourceStart ||
        !selectionInsideSource || !validSelection) {
        return {false, false, false, sourceStart, sourceStart,
                selectionStart, selectionEnd, sourceEnd, sourceEnd};
    }

    return {
        true,
        selectionStart - sourceStart >= minimumSegmentDuration,
        sourceEnd - selectionEnd >= minimumSegmentDuration,
        sourceStart,
        selectionStart,
        selectionStart,
        selectionEnd,
        selectionEnd,
        sourceEnd,
    };
}

void pushUndoState(const std::string& state) {
    undoHistory.push_back(state);
}

bool canUndo() {
    return !undoHistory.empty();
}

std::string popUndoState() {
    if (undoHistory.empty()) return "";
    std::string state = undoHistory.back();
    undoHistory.pop_back();
    return state;
}

void clearUndoHistory() {
    undoHistory.clear();
}

double timelinePlayheadPercent(
    double totalDuration,
    double elapsedBeforeClip,
    double clipPlaybackTime
) {
    if (!std::isfinite(totalDuration) || totalDuration <= 0 ||
        !std::isfinite(elapsedBeforeClip) || !std::isfinite(clipPlaybackTime)) {
        return 0;
    }

    const double timelineTime = elapsedBeforeClip + clipPlaybackTime;
    return std::max(0.0, std::min(100.0, timelineTime / totalDuration * 100.0));
}

double timelineTimeFromPercent(double totalDuration, double percent) {
    if (!std::isfinite(totalDuration) || totalDuration <= 0 ||
        !std::isfinite(percent)) {
        return 0;
    }

    const double clampedPercent = std::max(0.0, std::min(100.0, percent));
    return totalDuration * clampedPercent / 100.0;
}

int saveSpotifyTrack(
    const std::string& id,
    const std::string& name,
    const std::string& artists,
    double duration,
    const std::string& spotifyUrl
) {
    for (std::size_t index = 0; index < spotifyTracks.size(); ++index) {
        if (spotifyTracks[index].id == id) return static_cast<int>(index);
    }

    spotifyTracks.push_back({id, name, artists, duration, spotifyUrl});
    return static_cast<int>(spotifyTracks.size() - 1);
}

int spotifyTrackCount() {
    return static_cast<int>(spotifyTracks.size());
}

SpotifyTrackRecord getSpotifyTrack(int index) {
    if (index < 0 || index >= static_cast<int>(spotifyTracks.size())) return {};
    return spotifyTracks[index];
}

int saveAudioAsset(const std::string& name, const emscripten::val& bytes) {
    const unsigned int length = bytes["length"].as<unsigned int>();
    AudioAsset asset{name, std::vector<unsigned char>(length)};
    for (unsigned int index = 0; index < length; ++index) {
        asset.bytes[index] = bytes[index].as<unsigned char>();
    }
    audioAssets.push_back(std::move(asset));
    return static_cast<int>(audioAssets.size() - 1);
}

int audioAssetSize(int index) {
    if (index < 0 || index >= static_cast<int>(audioAssets.size())) return 0;
    return static_cast<int>(audioAssets[index].bytes.size());
}
