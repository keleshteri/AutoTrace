import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, Hierarchy } from "../lib/api";

type Props = {
  onError: (msg: string | null) => void;
};

export function Projects({ onError }: Props) {
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [clientName, setClientName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectClientId, setProjectClientId] = useState<number | "">("");
  const [taskName, setTaskName] = useState("");
  const [taskProjectId, setTaskProjectId] = useState<number | "">("");

  const refresh = useCallback(async () => {
    try {
      setHierarchy(await api.getHierarchy());
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addClient(e: FormEvent) {
    e.preventDefault();
    const name = clientName.trim();
    if (!name) return;
    await api.createClient(name);
    setClientName("");
    await refresh();
  }

  async function addProject(e: FormEvent) {
    e.preventDefault();
    const name = projectName.trim();
    if (!name || projectClientId === "") return;
    await api.createProject(projectClientId, name);
    setProjectName("");
    await refresh();
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    const name = taskName.trim();
    if (!name || taskProjectId === "") return;
    await api.createTask(taskProjectId, name);
    setTaskName("");
    await refresh();
  }

  const allProjects =
    hierarchy?.clients.flatMap((c) =>
      c.projects.map((p) => ({ ...p, clientName: c.name })),
    ) ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Clients → Projects → Tasks</h2>
      </div>

      <div className="forms">
        <form onSubmit={(e) => void addClient(e)} className="mini-form">
          <label>
            New client
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Acme Co"
            />
          </label>
          <button type="submit">Add</button>
        </form>

        <form onSubmit={(e) => void addProject(e)} className="mini-form">
          <label>
            New project
            <select
              value={projectClientId}
              onChange={(e) =>
                setProjectClientId(
                  e.target.value ? Number(e.target.value) : "",
                )
              }
            >
              <option value="">Select client…</option>
              {(hierarchy?.clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Website redesign"
          />
          <button type="submit">Add</button>
        </form>

        <form onSubmit={(e) => void addTask(e)} className="mini-form">
          <label>
            New task
            <select
              value={taskProjectId}
              onChange={(e) =>
                setTaskProjectId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Select project…</option>
              {allProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} / {p.name}
                </option>
              ))}
            </select>
          </label>
          <input
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            placeholder="Homepage mockups"
          />
          <button type="submit">Add</button>
        </form>
      </div>

      {(!hierarchy || hierarchy.clients.length === 0) && (
        <p className="muted">No clients yet — add one above to start tagging.</p>
      )}

      <ul className="tree">
        {(hierarchy?.clients ?? []).map((c) => (
          <li key={c.id}>
            <div className="tree-client">{c.name}</div>
            <ul>
              {c.projects.map((p) => (
                <li key={p.id}>
                  <div className="tree-project">{p.name}</div>
                  <ul>
                    {p.tasks.map((t) => (
                      <li key={t.id} className="tree-task">
                        {t.name}
                      </li>
                    ))}
                    {p.tasks.length === 0 && (
                      <li className="muted tree-task">No tasks</li>
                    )}
                  </ul>
                </li>
              ))}
              {c.projects.length === 0 && (
                <li className="muted">No projects</li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
