import { useState } from "react";

const TRANSITIONS = [
  { id: "crossfade", name: "Crossfade" },
  { id: "fade-black", name: "Fade to black" },
  { id: "fade-white", name: "Fade to white" },
  { id: "slide-left", name: "Slide left" },
  { id: "slide-right", name: "Slide right" },
  { id: "wipe", name: "Wipe" },
  { id: "zoom", name: "Zoom" },
];

function AddTransitionModal({ initialTransition, onConfirm, onClose }) {
  const [transitionType, setTransitionType] = useState(
    initialTransition?.type ?? "crossfade",
  );
  const [duration, setDuration] = useState(initialTransition?.duration ?? 1);

  return (
    <div className="music-modal-backdrop" onClick={onClose}>
      <section
        className="music-modal transition-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transition-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="music-modal-heading">
          <div>
            <h2 id="transition-modal-title">Add transition</h2>
            <p>Choose how the clips blend together</p>
          </div>
          <button
            type="button"
            className="music-modal-close"
            onClick={onClose}
            aria-label="Close transition picker"
          >
            ×
          </button>
        </div>

        <div className="transition-options">
          {TRANSITIONS.map((transition) => (
            <button
              type="button"
              className={transitionType === transition.id ? "selected" : ""}
              key={transition.id}
              onClick={() => setTransitionType(transition.id)}
              aria-pressed={transitionType === transition.id}
            >
              <span className={`transition-preview ${transition.id}`} aria-hidden="true">
                <i />
                <i />
              </span>
              <strong>{transition.name}</strong>
            </button>
          ))}
        </div>

        <div className="transition-modal-footer">
          <label>
            <span>Duration in seconds</span>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="splice-button"
            onClick={() => onConfirm({
              type: transitionType,
              duration: Math.max(0.1, Math.min(10, Number(duration) || 1)),
            })}
          >
            Apply transition
          </button>
        </div>
      </section>
    </div>
  );
}

export default AddTransitionModal;
