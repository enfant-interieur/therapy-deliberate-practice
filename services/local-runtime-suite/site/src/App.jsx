import React, { useEffect, useMemo, useState } from "react";

const fetchJson = async (path) => {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return res.json();
};

export default function App() {
  const [models, setModels] = useState([]);
  const [releases, setReleases] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchJson("/models.json").then(setModels).catch(() => setModels([]));
    fetchJson("/releases.json").then((data) => setReleases(data.releases || [])).catch(() => setReleases([]));
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return models.filter((model) =>
      [model.id, model.display?.title, model.display?.description, ...(model.display?.tags || [])]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [models, query]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>Local Runtime Suite</h1>
          <p>Download the desktop launcher and browse local models.</p>
        </div>
        <div className="hero-actions">
          {releases.length === 0 && <span className="pill">No releases yet</span>}
          {releases.map((release) => (
            <a key={release.platform} className="button" href={release.url}>
              {release.label}
            </a>
          ))}
        </div>
      </header>

      <section className="catalog">
        <div className="catalog-header">
          <h2>Model Catalog</h2>
          <input
            type="search"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="grid">
          {filtered.map((model) => (
            <article className="card" key={model.id}>
              <div className="card-header">
                <div>
                  <h3>{model.display.title}</h3>
                  <p>{model.display.description}</p>
                </div>
                <span className="pill">{model.kind}</span>
              </div>
              <div className="meta">
                <span>{model.api.endpoint}</span>
                <span>{model.backend.provider}</span>
              </div>
              <div className="tags">
                {(model.display.tags || []).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
