function LoadProjectModal({ projects, loadingId, onLoad, onClose }) {
  return (
    <div className="music-modal-backdrop" onClick={onClose}>
      <section
        className="music-modal load-project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="load-project-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="music-modal-heading">
          <div>
            <h2 id="load-project-title">Load project</h2>
            <p>Choose a saved project snapshot</p>
          </div>
          <button
            type="button"
            className="music-modal-close"
            onClick={onClose}
            aria-label="Close saved projects"
          >
            ×
          </button>
        </div>
        <div className="saved-project-list">
          {projects.length === 0 && <p>No saved projects yet.</p>}
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() => onLoad(project.id)}
              disabled={Boolean(loadingId)}
            >
              <strong>{new Date(project.savedAt).toLocaleString()}</strong>
              <span>
                {project.videoCount} video clips · {project.musicCount} music tracks
              </span>
              <small>{loadingId === project.id ? "Loading…" : "Load"}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export default LoadProjectModal;
