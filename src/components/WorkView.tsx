import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, Hierarchy } from "../lib/api";

type Props = {
  mode: "projects" | "clients" | "tasks";
  onError: (msg: string | null) => void;
};

export function WorkView({ mode, onError }: Props) {
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

  const title =
    mode === "clients" ? "Clients" : mode === "tasks" ? "Tasks" : "Projects";

  return (
    <div className="page">
      <div className="page-head">
        <h2>{title}</h2>
      </div>

      <div className="forms">
        {(mode === "clients" || mode === "projects") && (
          <form onSubmit={(e) => void addClient(e)} className="mini-form">
            <label>
              New client
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Acme Co"
              />
            </label>
            <div />
            <button type="submit">Add</button>
          </form>
        )}

        {(mode === "projects" || mode === "tasks") && (
          <form onSubmit={(e) => void addProject(e)} className="mini-form">
            <label>
              Client
              <select
                value={projectClientId}
                onChange={(e) =>
                  setProjectClientId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">Select…</option>
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
              placeholder="New project"
            />
            <button type="submit">Add project</button>
          </form>
        )}

        {mode === "tasks" && (
          <form onSubmit={(e) => void addTask(e)} className="mini-form">
            <label>
              Project
              <select
                value={taskProjectId}
                onChange={(e) =>
                  setTaskProjectId(e.target.value ? Number(e.target.value) : "")
                }
              >
                <option value="">Select…</option>
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
              placeholder="New task"
            />
            <button type="submit">Add task</button>
          </form>
        )}
      </div>

      {(!hierarchy || hierarchy.clients.length === 0) && (
        <p className="muted">No clients yet — add one to start tagging sessions.</p>
      )}

      <ul className="tree">
        {(hierarchy?.clients ?? []).map((c) => (
          <li key={c.id}>
            <div className="tree-client">
              {c.name}
              {mode === "clients" && (
                <span className="muted" style={{ marginLeft: 8 }}>
                  $
                  <input
                    type="number"
                    style={{ width: 72, marginLeft: 4 }}
                    defaultValue={c.hourly_rate ?? ""}
                    placeholder="rate"
                    onBlur={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      void api.setClientRate(c.id, v).then(refresh);
                    }}
                  />
                  /hr
                </span>
              )}
            </div>
            {(mode === "projects" || mode === "tasks") && (
              <ul>
                {c.projects.map((p) => (
                  <li key={p.id}>
                    <div className="tree-project">
                      {p.name}
                      {mode === "projects" && (
                        <span className="muted" style={{ marginLeft: 8 }}>
                          $
                          <input
                            type="number"
                            style={{ width: 72, marginLeft: 4 }}
                            defaultValue={p.hourly_rate ?? ""}
                            placeholder="rate"
                            onBlur={(e) => {
                              const v = e.target.value
                                ? Number(e.target.value)
                                : null;
                              void api
                                .setProjectRate(p.id, v, p.budget_hours)
                                .then(refresh);
                            }}
                          />
                          /hr
                        </span>
                      )}
                    </div>
                    {mode === "tasks" && (
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
                    )}
                  </li>
                ))}
                {c.projects.length === 0 && (
                  <li className="muted">No projects</li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
