import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Equipment,
  EquipmentCategory,
  EquipmentTasksRepository,
  EquipmentTasksWorkspace,
  FarmTask,
  IntervalWrite,
  TaskPriority,
  TaskStatus,
} from "./data/equipmentTasks";
import { farmerError } from "./lib/farmerErrors";
import { createSubmitLock, createSubmitLockMap } from "./lib/submitLock";
const today = () => new Date().toISOString().slice(0, 10);
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const categories: EquipmentCategory[] = [
  "tractor",
  "combine",
  "sprayer",
  "truck",
  "trailer",
  "header",
  "tillage",
  "planter",
  "grain_cart",
  "utility",
  "other",
];
const categoryLabel = (v: string) =>
  v.replace("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());
function useWorkspace(repository: EquipmentTasksRepository) {
  const [workspace, setWorkspace] = useState<EquipmentTasksWorkspace | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    setLoading(true);
    try {
      setWorkspace(await repository.getWorkspace());
      setError(null);
    } catch (e) {
      setError(farmerError(e, "load equipment and tasks"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, [repository]);
  return { workspace, error, loading, reload };
}
function Notice({ error }: { error: string | null }) {
  return error ? (
    <p className="equipment-error" role="alert">
      {error}
    </p>
  ) : null;
}
export function EquipmentPage({
  repository,
}: {
  repository: EquipmentTasksRepository;
}) {
  const { workspace, error, loading, reload } = useWorkspace(repository);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (loading && !workspace)
    return (
      <section className="page equipment-page">
        <p>Loading equipment…</p>
      </section>
    );
  if (!workspace)
    return (
      <section className="page equipment-page">
        <Notice error={error} />
      </section>
    );
  const current = workspace.equipment.find((x) => x.id === selected) ?? null;
  const canManage =
    workspace.viewer.role === "owner" || workspace.viewer.role === "manager";
  return (
    <section className="page equipment-page">
      <header className="equipment-heading">
        <div>
          <p className="eyebrow">Equipment</p>
          <h1>Keep every machine ready to work.</h1>
        </div>
        {canManage && (
          <button
            className="primary-action"
            onClick={() => {
              setAdding(true);
              setSelected(null);
            }}
          >
            Add machine
          </button>
        )}
      </header>
      <Notice error={error} />
      {adding && canManage && (
        <EquipmentForm
          repository={repository}
          equipment={null}
          done={() => {
            setAdding(false);
            void reload();
          }}
          cancel={() => setAdding(false)}
        />
      )}
      {current && (
        <EquipmentDetail
          repository={repository}
          workspace={workspace}
          equipment={current}
          close={() => {
            setSelected(null);
            void reload();
          }}
        />
      )}
      {!current && !adding && (
        <EquipmentCards workspace={workspace} choose={setSelected} />
      )}
    </section>
  );
}
function EquipmentCards({
  workspace,
  choose,
}: {
  workspace: EquipmentTasksWorkspace;
  choose: (id: string) => void;
}) {
  const grouped = categories
    .map(
      (category) =>
        [
          category,
          workspace.equipment.filter((x) => x.category === category),
        ] as const,
    )
    .filter(([, rows]) => rows.length);
  if (!grouped.length)
    return (
      <div className="teaching-empty">
        <h2>No machines yet.</h2>
        <p>Add the first machine to track service, costs, and hours.</p>
      </div>
    );
  return (
    <div className="equipment-groups">
      {grouped.map(([category, rows]) => (
        <section key={category}>
          <h2>{categoryLabel(category)}</h2>
          <div className="machine-grid">
            {rows.map((machine) => {
              const readings = workspace.meter_readings
                .filter((x) => x.equipment_id === machine.id)
                .sort(
                  (a, b) =>
                    b.read_on.localeCompare(a.read_on) ||
                    b.created_at.localeCompare(a.created_at),
                );
              const due = workspace.service_due.some(
                (x) => x.equipment_id === machine.id,
              );
              const cost = workspace.service_log
                .filter((x) => x.equipment_id === machine.id)
                .reduce((sum, x) => sum + (x.cost ?? 0), 0);
              const warranty =
                machine.warranty_expires_on &&
                Math.ceil(
                  (Date.parse(`${machine.warranty_expires_on}T00:00:00Z`) -
                    Date.now()) /
                    86400000,
                ) <= 60;
              return (
                <button
                  type="button"
                  className="machine-card"
                  key={machine.id}
                  onClick={() => choose(machine.id)}
                >
                  <strong>{machine.name}</strong>
                  <span>
                    {[machine.make, machine.model, machine.model_year]
                      .filter(Boolean)
                      .join(" ") || "Machine details not entered"}
                  </span>
                  <div className="machine-facts">
                    <b>
                      {readings[0]
                        ? `${number.format(readings[0].reading)} ${machine.meter_unit}`
                        : `No ${machine.meter_unit} yet`}
                    </b>
                    <b>{money.format(cost)} service cost</b>
                  </div>
                  <div className="chip-row">
                    <em className="status-chip">{machine.status}</em>
                    {due && <em className="due-chip">Service due</em>}
                    {warranty && (
                      <em className="warranty-chip">
                        Warranty {machine.warranty_expires_on}
                      </em>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
function EquipmentForm({
  repository,
  equipment,
  done,
  cancel,
}: {
  repository: EquipmentTasksRepository;
  equipment: Equipment | null;
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(createSubmitLock());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!submitLock.current.acquire()) return;
    const f = new FormData(e.currentTarget);
    try {
      await repository.saveEquipment({
        id: equipment?.id ?? crypto.randomUUID(),
        farm_id: equipment?.farm_id ?? "",
        name: String(f.get("name") ?? "").trim(),
        category: String(f.get("category")) as EquipmentCategory,
        make: String(f.get("make") ?? "").trim() || null,
        model: String(f.get("model") ?? "").trim() || null,
        model_year: f.get("year") ? Number(f.get("year")) : null,
        serial_or_vin: String(f.get("serial") ?? "").trim() || null,
        purchase_date: String(f.get("purchaseDate") ?? "") || null,
        purchase_price: f.get("price") ? Number(f.get("price")) : null,
        meter_unit: String(f.get("unit")) as "hours" | "miles",
        warranty_expires_on: String(f.get("warranty") ?? "") || null,
        warranty_notes: String(f.get("warrantyNotes") ?? "").trim() || null,
        status: String(f.get("status")) as Equipment["status"],
        notes: String(f.get("notes") ?? "").trim() || null,
      });
      done();
    } catch (caught) {
      setError(farmerError(caught, "save this machine"));
    } finally {
      submitLock.current.release();
    }
  }
  return (
    <form className="equipment-form" onSubmit={submit}>
      <h2>{equipment ? "Edit machine" : "Add machine"}</h2>
      <label>
        Name
        <input name="name" defaultValue={equipment?.name} required />
      </label>
      <label>
        Category
        <select name="category" defaultValue={equipment?.category ?? "tractor"}>
          {categories.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label>
        Make
        <input name="make" defaultValue={equipment?.make ?? ""} />
      </label>
      <label>
        Model
        <input name="model" defaultValue={equipment?.model ?? ""} />
      </label>
      <label>
        Year
        <input
          name="year"
          type="number"
          min="1900"
          max="2100"
          defaultValue={equipment?.model_year ?? ""}
        />
      </label>
      <label>
        Serial or VIN
        <input name="serial" defaultValue={equipment?.serial_or_vin ?? ""} />
      </label>
      <label>
        Meter
        <select name="unit" defaultValue={equipment?.meter_unit ?? "hours"}>
          <option value="hours">Hours</option>
          <option value="miles">Miles</option>
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={equipment?.status ?? "active"}>
          <option value="active">Active</option>
          <option value="sold">Sold</option>
          <option value="retired">Retired</option>
        </select>
      </label>
      <label>
        Purchase date
        <input
          name="purchaseDate"
          type="date"
          defaultValue={equipment?.purchase_date ?? ""}
        />
      </label>
      <label>
        Purchase price
        <input
          name="price"
          type="number"
          min="0"
          step="any"
          defaultValue={equipment?.purchase_price ?? ""}
        />
      </label>
      <label>
        Warranty ends
        <input
          name="warranty"
          type="date"
          defaultValue={equipment?.warranty_expires_on ?? ""}
        />
      </label>
      <label className="wide">
        Warranty notes
        <input
          name="warrantyNotes"
          defaultValue={equipment?.warranty_notes ?? ""}
        />
      </label>
      <label className="wide">
        Notes
        <textarea name="notes" defaultValue={equipment?.notes ?? ""} />
      </label>
      <Notice error={error} />
      <div>
        <button className="primary-action">Save machine</button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function EquipmentDetail({
  repository,
  workspace,
  equipment,
  close,
}: {
  repository: EquipmentTasksRepository;
  workspace: EquipmentTasksWorkspace;
  equipment: Equipment;
  close: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const equipmentLock = useRef(createSubmitLock());
  const canManage =
    workspace.viewer.role === "owner" || workspace.viewer.role === "manager";
  const readings = workspace.meter_readings
    .filter((x) => x.equipment_id === equipment.id)
    .sort((a, b) => b.read_on.localeCompare(a.read_on));
  const intervals = workspace.intervals.filter(
    (x) => x.equipment_id === equipment.id,
  );
  const logs = workspace.service_log
    .filter((x) => x.equipment_id === equipment.id)
    .sort((a, b) => b.service_date.localeCompare(a.service_date));
  const due = new Set(
    workspace.service_due
      .filter((x) => x.equipment_id === equipment.id)
      .map((x) => x.interval_id),
  );
  async function meter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!equipmentLock.current.acquire()) return;
    const f = new FormData(e.currentTarget);
    try {
      await repository.addMeterReading({
        id: crypto.randomUUID(),
        equipment_id: equipment.id,
        reading: Number(f.get("reading")),
        read_on: String(f.get("date")),
        source: "manual",
        notes: null,
      });
      close();
    } catch (caught) {
      setError(farmerError(caught, "save this meter reading"));
    } finally {
      equipmentLock.current.release();
    }
  }
  async function removeInterval(id: string) {
    if (!equipmentLock.current.acquire()) return;
    try {
      await repository.deleteInterval(id);
      close();
    } catch (caught) {
      setError(farmerError(caught, "delete this service reminder"));
    } finally {
      equipmentLock.current.release();
    }
  }
  async function addServiceTask() {
    if (!equipmentLock.current.acquire()) return;
    try {
      await repository.saveTask({
        id: crypto.randomUUID(),
        title: `Service — ${equipment.name}`,
        details: null,
        status: "todo",
        priority: "high",
        assigned_to: null,
        due_on: null,
        field_id: null,
        equipment_id: equipment.id,
        source: "manual",
        interval_id: null,
        interval_cycle_key: null,
      });
      close();
    } catch (caught) {
      setError(farmerError(caught, "add this service task"));
    } finally {
      equipmentLock.current.release();
    }
  }
  async function removeServiceLog(id: string) {
    if (!equipmentLock.current.acquire()) return;
    try {
      await repository.deleteServiceLogEntry(id);
      close();
    } catch (caught) {
      setError(farmerError(caught, "delete this service entry"));
    } finally {
      equipmentLock.current.release();
    }
  }
  async function interval(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!equipmentLock.current.acquire()) return;
    const f = new FormData(e.currentTarget);
    try {
      const value: IntervalWrite = {
        id: crypto.randomUUID(),
        equipment_id: equipment.id,
        name: String(f.get("name")).trim(),
        every_meter: f.get("meter") ? Number(f.get("meter")) : null,
        every_months: f.get("months") ? Number(f.get("months")) : null,
        last_done_on: null,
        last_done_reading: null,
        is_active: true,
      };
      await repository.saveInterval(value);
      close();
    } catch (caught) {
      setError(farmerError(caught, "save this service reminder"));
    } finally {
      equipmentLock.current.release();
    }
  }
  async function log(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!equipmentLock.current.acquire()) return;
    try {
      const f = new FormData(e.currentTarget);
      const intervalId = String(f.get("interval")) || null;
      try {
        await repository.addServiceLogEntry({
          id: crypto.randomUUID(),
          equipment_id: equipment.id,
          service_date: String(f.get("date")),
          work_performed: String(f.get("work")).trim(),
          parts: String(f.get("parts")).trim() || null,
          vendor: String(f.get("vendor")).trim() || null,
          cost: f.get("cost") ? Number(f.get("cost")) : null,
          meter_reading: f.get("reading") ? Number(f.get("reading")) : null,
          interval_id: intervalId,
        });
      } catch (caught) {
        setError(farmerError(caught, "log this service"));
        return;
      }
      // The service is logged and the reminder reset; leftover auto-generated task cards for
      // that reminder would otherwise sit open on the board until someone closes them by hand.
      const leftover = intervalId
        ? workspace.tasks.filter(
            (task) =>
              task.source === "service_interval" &&
              task.interval_id === intervalId &&
              task.status !== "done",
          )
        : [];
      try {
        for (const task of leftover)
          await repository.saveTask({
            id: task.id,
            title: task.title,
            details: task.details,
            status: "done",
            priority: task.priority,
            assigned_to: task.assigned_to,
            due_on: task.due_on,
            field_id: task.field_id,
            equipment_id: task.equipment_id,
            source: task.source,
            interval_id: task.interval_id,
            interval_cycle_key: task.interval_cycle_key,
            program_assigned_pass_id: task.program_assigned_pass_id,
            program_cycle_key: task.program_cycle_key,
          });
      } catch {
        setError(
          "The service was logged. One open service task card could not be closed automatically — you can mark it done on the Tasks board.",
        );
        return;
      }
      close();
    } finally {
      equipmentLock.current.release();
    }
  }
  return (
    <section className="equipment-detail">
      <div className="detail-heading">
        <h2>{equipment.name}</h2>
        <button onClick={close}>Back to machines</button>
      </div>
      <Notice error={error} />
      {editing ? (
        <EquipmentForm
          repository={repository}
          equipment={equipment}
          done={close}
          cancel={() => setEditing(false)}
        />
      ) : (
        canManage && (
          <button onClick={() => setEditing(true)}>Edit machine</button>
        )
      )}
      <div className="detail-grid">
        <section>
          <h3>Update {equipment.meter_unit}</h3>
          <form className="equipment-form compact" onSubmit={meter}>
            <label>
              {equipment.meter_unit}
              <input name="reading" type="number" min="0" step="any" required />
            </label>
            <label>
              Date
              <input name="date" type="date" defaultValue={today()} required />
            </label>
            <button className="primary-action">Save reading</button>
          </form>
          <p>
            Latest:{" "}
            {readings[0]
              ? `${number.format(readings[0].reading)} ${equipment.meter_unit} on ${readings[0].read_on}`
              : "Not entered"}
          </p>
        </section>
        <section>
          <h3>Service reminders</h3>
          {intervals.map((x) => (
            <div className="list-row" key={x.id}>
              <span>
                <b>{x.name}</b> ·{" "}
                {x.every_meter
                  ? `every ${x.every_meter} ${equipment.meter_unit}`
                  : ""}
                {x.every_meter && x.every_months ? " or " : ""}
                {x.every_months ? `every ${x.every_months} months` : ""}
              </span>
              {due.has(x.id) && <em className="due-chip">Due</em>}
              {canManage && (
                <button
                  className="danger-action"
                  onClick={() => {
                    if (window.confirm("Delete this service reminder?"))
                      void removeInterval(x.id);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <form className="equipment-form compact" onSubmit={interval}>
              <label>
                Name
                <input name="name" placeholder="Oil change" required />
              </label>
              <label>
                Every {equipment.meter_unit}
                <input name="meter" type="number" min="0.01" step="any" />
              </label>
              <label>
                Every months
                <input name="months" type="number" min="1" />
              </label>
              <button className="primary-action">Add reminder</button>
            </form>
          )}
        </section>
      </div>
      <section className="service-log">
        <h3>Log service</h3>
        <form className="equipment-form" onSubmit={log}>
          <label>
            Date
            <input name="date" type="date" defaultValue={today()} required />
          </label>
          <label>
            Work performed
            <input name="work" required />
          </label>
          <label>
            Parts
            <input name="parts" />
          </label>
          <label>
            Vendor
            <input name="vendor" />
          </label>
          <label>
            Cost
            <input name="cost" type="number" min="0" step="any" />
          </label>
          <label>
            Meter reading
            <input name="reading" type="number" min="0" step="any" />
          </label>
          <label>
            Completes reminder
            <select name="interval">
              <option value="">No reminder</option>
              {intervals.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-action">Log service</button>
        </form>
        <button
          className="secondary-action"
          onClick={() => void addServiceTask()}
        >
          Add service task
        </button>
        <h3>Service history</h3>
        {logs.length ? (
          logs.map((x) => (
            <div className="list-row" key={x.id}>
              <span>
                <b>{x.service_date}</b> · {x.work_performed}
                {x.vendor ? ` · ${x.vendor}` : ""}
              </span>
              <strong>{x.cost === null ? "—" : money.format(x.cost)}</strong>
              {canManage && (
                <button
                  className="danger-action"
                  onClick={() => {
                    if (window.confirm("Delete this service entry?"))
                      void removeServiceLog(x.id);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          ))
        ) : (
          <p>No service history yet.</p>
        )}
      </section>
    </section>
  );
}
export type TaskBoardFilter = "open" | "mine" | "overdue" | "done" | null;
export function filterTasksForBoard(
  tasks: FarmTask[],
  viewerUserId: string,
  filter: TaskBoardFilter,
  now = today(),
) {
  if (filter === null) return tasks;
  if (filter === "open") return tasks.filter((task) => task.status !== "done");
  if (filter === "mine")
    return tasks.filter((task) => task.assigned_to === viewerUserId);
  if (filter === "overdue")
    return tasks.filter(
      (task) => task.status !== "done" && !!task.due_on && task.due_on < now,
    );
  return tasks.filter((task) => task.status === "done");
}
export function programTaskBoardBehavior(task: FarmTask) {
  const trackerOwned = task.source === "program";
  return {
    trackerOwned,
    href:
      trackerOwned && task.program_assigned_pass_id
        ? `/programs?pass=${task.program_assigned_pass_id}`
        : null,
  };
}
export function TasksPage({
  repository,
}: {
  repository: EquipmentTasksRepository;
}) {
  const { workspace, error, loading, reload } = useWorkspace(repository);
  const [filter, setFilter] = useState<TaskBoardFilter>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FarmTask | null>(null);
  if (loading && !workspace)
    return (
      <section className="page tasks-page">
        <p>Loading tasks…</p>
      </section>
    );
  if (!workspace)
    return (
      <section className="page tasks-page">
        <Notice error={error} />
      </section>
    );
  const currentId = workspace.viewer.user_id;
  const shown = filterTasksForBoard(workspace.tasks, currentId, filter);
  return (
    <section className="page tasks-page">
      <header className="equipment-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Keep the next job clear for everyone.</h1>
        </div>
        <button
          className="primary-action"
          onClick={() => {
            setAdding(true);
            setEditing(null);
          }}
        >
          Add task
        </button>
      </header>
      <Notice error={error} />
      <Kpis
        tasks={workspace.tasks}
        currentId={currentId}
        filter={filter}
        set={setFilter}
      />
      {(adding || editing) && (
        <TaskForm
          repository={repository}
          workspace={workspace}
          task={editing}
          done={() => {
            setAdding(false);
            setEditing(null);
            void reload();
          }}
          cancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      <div className="task-board">
        {(["todo", "doing", "done"] as TaskStatus[]).map((status) => (
          <TaskColumn
            key={status}
            status={status}
            tasks={shown.filter((x) => x.status === status)}
            workspace={workspace}
            repository={repository}
            refresh={reload}
            edit={setEditing}
          />
        ))}
      </div>
    </section>
  );
}
function Kpis({
  tasks,
  currentId,
  filter,
  set,
}: {
  tasks: FarmTask[];
  currentId: string;
  filter: TaskBoardFilter;
  set: (v: TaskBoardFilter) => void;
}) {
  const now = today();
  const items: Array<[Exclude<TaskBoardFilter, null>, string, number]> = [
    ["open", "Open", tasks.filter((x) => x.status !== "done").length],
    [
      "mine",
      "Mine",
      tasks.filter((x) => x.assigned_to === currentId && x.status !== "done")
        .length,
    ],
    [
      "overdue",
      "Overdue",
      tasks.filter((x) => x.status !== "done" && !!x.due_on && x.due_on < now)
        .length,
    ],
    ["done", "Done", tasks.filter((x) => x.status === "done").length],
  ];
  return (
    <div className="task-kpis">
      {items.map(([key, label, value]) => (
        <button
          className={filter === key ? "active" : ""}
          key={key}
          onClick={() => set(filter === key ? null : key)}
        >
          <strong>{value}</strong>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
function TaskColumn({
  status,
  tasks,
  workspace,
  repository,
  refresh,
  edit,
}: {
  status: TaskStatus;
  tasks: FarmTask[];
  workspace: EquipmentTasksWorkspace;
  repository: EquipmentTasksRepository;
  refresh: () => Promise<void>;
  edit: (x: FarmTask) => void;
}) {
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const taskLocks = useRef(createSubmitLockMap());
  const rows = [...tasks].sort(
    status === "done"
      ? (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
      : (a, b) =>
          overdueSort(a) - overdueSort(b) ||
          (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"),
  );
  const visible = status === "done" && !more ? rows.slice(0, 10) : rows;
  const canManage =
    workspace.viewer.role === "owner" || workspace.viewer.role === "manager";
  const move = async (task: FarmTask, next: TaskStatus) => {
    const taskLock = taskLocks.current.get(task.id);
    if (!taskLock.acquire()) return;
    try {
      await repository.saveTask({
        id: task.id,
        title: task.title,
        details: task.details,
        status: next,
        priority: task.priority,
        assigned_to: task.assigned_to,
        due_on: task.due_on,
        field_id: task.field_id,
        equipment_id: task.equipment_id,
        source: task.source,
        interval_id: task.interval_id,
        interval_cycle_key: task.interval_cycle_key,
        program_assigned_pass_id: task.program_assigned_pass_id,
        program_cycle_key: task.program_cycle_key,
      });
      await refresh();
    } finally {
      taskLock.release();
    }
  };
  const remove = async (task: FarmTask) => {
    const taskLock = taskLocks.current.get(task.id);
    if (!taskLock.acquire()) return;
    try {
      await repository.deleteTask(task.id);
      await refresh();
    } finally {
      taskLock.release();
    }
  };
  return (
    <section className="task-column">
      <h2>
        {status === "todo" ? "To Do" : status === "doing" ? "Doing" : "Done"}
      </h2>
      {visible.length ? (
        visible.map((task) => {
          const member = workspace.members.find(
            (x) => x.user_id === task.assigned_to,
          );
          const field = workspace.fields.fields.find(
            (x) => x.id === task.field_id,
          );
          const machine = workspace.equipment.find(
            (x) => x.id === task.equipment_id,
          );
          const severity = dueClass(task);
          const programCard = programTaskBoardBehavior(task);
          const programHref = programCard.href;
          return (
            <article
              className={`task-card ${severity}${programCard.trackerOwned ? " program-task" : ""}`}
              key={task.id}
            >
              {programHref ? (
                <button
                  className="task-title-link"
                  onClick={() => navigate(programHref)}
                  aria-label={`Open ${task.title} in Programs`}
                >
                  {task.title}
                </button>
              ) : (
                <h3>{task.title}</h3>
              )}
              {task.priority !== "normal" && (
                <em className="priority-chip">{task.priority}</em>
              )}
              <p>
                {member?.display_name.split(/\s+/)[0] ?? "Unassigned"}
                {task.due_on ? ` · Due ${task.due_on}` : ""}
              </p>
              <div className="chip-row">
                {field && (
                  <button onClick={() => navigate(`/fields/${field.id}`)}>
                    {field.name}
                  </button>
                )}
                {machine && (
                  <button onClick={() => navigate("/equipment")}>
                    {machine.name}
                  </button>
                )}
              </div>
              {task.status === "done" && (
                <small>
                  Done by{" "}
                  {workspace.members.find(
                    (x) => x.user_id === task.completed_by,
                  )?.display_name ?? "farm member"}{" "}
                  ·{" "}
                  {task.completed_at
                    ? new Date(task.completed_at).toLocaleDateString()
                    : ""}
                </small>
              )}
              <div className="task-actions">
                {task.status === "todo" && (
                  <button onClick={() => void move(task, "doing")}>
                    Start
                  </button>
                )}
                {task.status !== "done" && (
                  <button
                    className="primary-action"
                    onClick={() => void move(task, "done")}
                  >
                    Done
                  </button>
                )}
                {task.status === "done" && (
                  <button onClick={() => void move(task, "todo")}>
                    Reopen
                  </button>
                )}
                {!programCard.trackerOwned && (
                  <button onClick={() => edit(task)}>Edit</button>
                )}
                {canManage && !programCard.trackerOwned && (
                  <button
                    className="danger-action"
                    onClick={() => {
                      if (window.confirm("Delete this task?"))
                        void remove(task);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          );
        })
      ) : (
        <p>Nothing here.</p>
      )}
      {status === "done" && rows.length > 10 && (
        <button onClick={() => setMore(!more)}>
          {more ? "Show less" : "Show more"}
        </button>
      )}
    </section>
  );
}
function overdueSort(t: FarmTask) {
  return t.status !== "done" && t.due_on && t.due_on < today() ? 0 : 1;
}
function dueClass(t: FarmTask) {
  if (!t.due_on || t.status === "done") return "";
  const days = Math.floor(
    (Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${t.due_on}T00:00:00Z`)) /
      86400000,
  );
  return days >= 7
    ? "critical"
    : days >= 3
      ? "overdue-red"
      : days > 0
        ? "overdue-amber"
        : "";
}
function TaskForm({
  repository,
  workspace,
  task,
  done,
  cancel,
}: {
  repository: EquipmentTasksRepository;
  workspace: EquipmentTasksWorkspace;
  task: FarmTask | null;
  done: () => void;
  cancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? "normal",
  );
  const submitLock = useRef(createSubmitLock());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!submitLock.current.acquire()) return;
    const f = new FormData(e.currentTarget);
    try {
      await repository.saveTask({
        id: task?.id ?? crypto.randomUUID(),
        title: String(f.get("title")).trim(),
        details: String(f.get("details")).trim() || null,
        status: task?.status ?? "todo",
        priority,
        assigned_to: String(f.get("assigned")) || null,
        due_on: String(f.get("due")) || null,
        field_id: String(f.get("field")) || null,
        equipment_id: String(f.get("equipment")) || null,
        source: task?.source ?? "manual",
        interval_id: task?.interval_id ?? null,
        interval_cycle_key: task?.interval_cycle_key ?? null,
        program_assigned_pass_id: task?.program_assigned_pass_id ?? null,
        program_cycle_key: task?.program_cycle_key ?? null,
      });
      done();
    } catch (caught) {
      setError(farmerError(caught, "save this task"));
    } finally {
      submitLock.current.release();
    }
  }
  return (
    <form className="equipment-form task-form" onSubmit={submit}>
      <h2>{task ? "Edit task" : "Add task"}</h2>
      <label className="wide">
        Job
        <input name="title" defaultValue={task?.title} required />
      </label>
      <label className="wide">
        Details
        <textarea name="details" defaultValue={task?.details ?? ""} />
      </label>
      <fieldset>
        <legend>Priority</legend>
        {(["normal", "high", "urgent"] as TaskPriority[]).map((x) => (
          <button
            type="button"
            className={priority === x ? "active" : ""}
            key={x}
            onClick={() => setPriority(x)}
          >
            {x}
          </button>
        ))}
      </fieldset>
      <label>
        Assigned to
        <select name="assigned" defaultValue={task?.assigned_to ?? ""}>
          <option value="">Unassigned</option>
          {workspace.members.map((x) => (
            <option key={x.user_id} value={x.user_id}>
              {x.display_name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input name="due" type="date" defaultValue={task?.due_on ?? ""} />
      </label>
      <label>
        Linked field
        <select name="field" defaultValue={task?.field_id ?? ""}>
          <option value="">No field</option>
          {workspace.fields.fields.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Linked machine
        <select name="equipment" defaultValue={task?.equipment_id ?? ""}>
          <option value="">No machine</option>
          {workspace.equipment.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <Notice error={error} />
      <div>
        <button className="primary-action">Save task</button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
