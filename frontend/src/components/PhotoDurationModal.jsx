import { useState } from "react";

function PhotoDurationModal({
  photoName,
  defaultDuration = 5,
  showPlacementOptions = false,
  onConfirm,
  onClose,
}) {
  const [duration, setDuration] = useState(defaultDuration);
  const [placement, setPlacement] = useState("insert-into");

  return (
    <div className="music-modal-backdrop" onClick={onClose}>
      <section
        className="music-modal photo-duration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-duration-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="music-modal-heading">
          <div>
            <h2 id="photo-duration-title">Photo duration</h2>
            <p title={photoName}>{photoName}</p>
          </div>
          <button
            type="button"
            className="music-modal-close"
            onClick={onClose}
            aria-label="Close photo duration"
          >
            ×
          </button>
        </div>
        <div className="photo-duration-field">
          {showPlacementOptions && (
            <fieldset className="photo-placement-options">
              <legend>Placement</legend>
              <label>
                <input
                  type="radio"
                  name="photo-placement"
                  value="insert-into"
                  checked={placement === "insert-into"}
                  onChange={(event) => setPlacement(event.target.value)}
                />
                <span>Insert into</span>
                <small>Start at the exact drop time over the video</small>
              </label>
              <label>
                <input
                  type="radio"
                  name="photo-placement"
                  value="insert-right"
                  checked={placement === "insert-right"}
                  onChange={(event) => setPlacement(event.target.value)}
                />
                <span>Insert right</span>
                <small>Place after the intersected video</small>
              </label>
            </fieldset>
          )}
          <label>
            <span>Duration in seconds</span>
            <input
              type="number"
              min="0.5"
              max="300"
              step="0.5"
              value={duration}
              autoFocus
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
        </div>
        <div className="add-text-actions">
          <button type="button" className="splice-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="splice-button"
            onClick={() => onConfirm(
              Math.max(0.5, Math.min(300, Number(duration) || 5)),
              placement,
            )}
          >
            Add photo
          </button>
        </div>
      </section>
    </div>
  );
}

export default PhotoDurationModal;
