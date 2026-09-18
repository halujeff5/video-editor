import { useState } from "react";

const FONT_OPTIONS = [
  { label: "IMPACT", value: "Impact, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Courier", value: '"Courier New", monospace' },
  { label: "Times New Roman", value: '"Times New Roman", serif' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
];

const FONT_SIZES = [16, 20, 24, 32, 40, 48, 64];

function AddTextModal({ startTime, onConfirm, onClose }) {
  const [text, setText] = useState("");
  const [duration, setDuration] = useState(3);
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[1].value);
  const [fontSize, setFontSize] = useState(32);
  const [color, setColor] = useState("#ffffff");

  return (
    <div className="music-modal-backdrop" onClick={onClose}>
      <section
        className="music-modal add-text-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-text-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="music-modal-heading">
          <div>
            <h2 id="add-text-title">Add text</h2>
            <p>Starts at {startTime.toFixed(1)} seconds</p>
          </div>
          <button
            type="button"
            className="music-modal-close"
            onClick={onClose}
            aria-label="Close text editor"
          >
            ×
          </button>
        </div>
        <div className="add-text-fields">
          <label>
            <span>Text</span>
            <input
              type="text"
              value={text}
              autoFocus
              onChange={(event) => setText(event.target.value)}
              placeholder="Enter text"
            />
          </label>
          <label>
            <span>Duration in seconds</span>
            <input
              type="number"
              min="0.1"
              max="60"
              step="0.1"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          <label>
            <span>Font</span>
            <select
              value={fontFamily}
              onChange={(event) => setFontFamily(event.target.value)}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.label} value={font.value}>{font.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Size</span>
            <select
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>{size} px</option>
              ))}
            </select>
          </label>
          <label className="text-color-field">
            <span>Color</span>
            <div>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                aria-label="Text color"
              />
              <output>{color.toUpperCase()}</output>
            </div>
          </label>
          <div
            className="text-style-preview"
            style={{ color, fontFamily, fontSize: `${Math.min(fontSize, 40)}px` }}
          >
            {text.trim() || "Text preview"}
          </div>
        </div>
        <div className="add-text-actions">
          <button type="button" className="splice-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="splice-button"
            disabled={!text.trim()}
            onClick={() => onConfirm({
              text: text.trim(),
              duration: Math.max(0.1, Math.min(60, Number(duration) || 3)),
              fontFamily,
              fontSize,
              color,
            })}
          >
            Add text
          </button>
        </div>
      </section>
    </div>
  );
}

export default AddTextModal;
