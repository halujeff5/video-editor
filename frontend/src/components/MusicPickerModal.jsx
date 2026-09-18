function MusicPickerModal({ tracks, onSelect, onClose }) {
  return (
    <div className="music-modal-backdrop" onClick={onClose}>
      <section
        className="music-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="music-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="music-modal-heading">
          <div>
            <h2 id="music-picker-title">Soundstripe music</h2>
            <p>Choose a licensed track</p>
          </div>
          <button
            type="button"
            className="music-modal-close"
            onClick={onClose}
            aria-label="Close music picker"
          >
            ×
          </button>
        </div>
        <ol className="music-track-list">
          {tracks.map((track) => (
            <li key={track.id}>
              <button type="button" onClick={() => onSelect(track)}>
                <strong>{track.name}</strong>
                <span>{track.artists}</span>
              </button>
              <span className="music-track-duration">
                {Math.floor(track.duration / 60)}:{Math.floor(track.duration % 60)
                  .toString().padStart(2, "0")}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default MusicPickerModal;
