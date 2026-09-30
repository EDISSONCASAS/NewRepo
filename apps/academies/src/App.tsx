import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, Building2, Check, ChevronDown, CircleAlert, FileSpreadsheet,
  Flag, Gauge, LogOut, Menu, Plus, Search, ShieldCheck, UsersRound, X,
} from "lucide-react";
import {
  api, type Academy, type AcademyUser, type ImportPreview,
  type RecordDraft, type StudentRecord, type User,
} from "./lib/api";
import { formatCurrency, formatDate } from "./lib/format";

type View = "records" | "academies" | "users" | "import";

const emptyRecord = (academyId: string): RecordDraft => ({
  academy_id: academyId,
  date: new Date().toISOString().slice(0, 10),
  order_number: "", advisor: "", document_type: "", full_name: "",
  document_number: "", procedure: "PRIMERA VEZ", category: "",
  payment_method: "", payment_crc_status: "", qpl_status: "",
  sheet_cost: null, qpl_cost: null, amount_due: null,
  medical_exam_cost: null, observations: "",
});

function Modal({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}><section className="modal-sheet" role="dialog" aria-modal="true">
    <header className="modal-header"><div><p className="eyebrow">PADDOCK · OPERACIONES</p><h2>{title}</h2></div>
      <button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button>
    </header>{children}
  </section></div>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { onLogin((await api.login(username.trim(), password)).user); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible iniciar sesión"); }
    finally { setBusy(false); }
  }
  return <main className="entry-shell">
    <section className="entry-art" aria-label="Pista de automovilismo">
      <div className="entry-brand"><span className="brand-mark"><Flag size={18} /></span><span>PADDOCK</span></div>
      <div className="entry-copy"><p className="eyebrow">GESTIÓN DE ACADEMIAS</p><h1>Todo el equipo.<br /><em>Una sola pista.</em></h1><p>Alumnos, trámites y academias en un espacio privado de trabajo.</p></div>
      <div className="entry-caption"><span className="caption-line" /><span>PLATAFORMA MULTIACADEMIA</span></div>
    </section>
    <section className="entry-panel">
      <div className="panel-topline"><span>PORTAL DE OPERACIONES</span><span className="secure-label"><ShieldCheck size={15} /> ACCESO PRIVADO</span></div>
      <div className="login-card"><p className="eyebrow">BIENVENIDO DE VUELTA</p><h2>Inicia sesión</h2><p className="login-intro">Ingresa con la cuenta que te asignó el administrador.</p>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="username">Usuario</label><input id="username" autoComplete="username" placeholder="Tu usuario" value={username} onChange={(event) => setUsername(event.target.value)} required />
          <label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" placeholder="Tu contraseña" value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <p className="form-error" role="alert"><CircleAlert size={15} />{error}</p>}
          <button className="sign-in-button" disabled={busy}>{busy ? "Verificando..." : "Entrar al portal"}<ArrowRight size={17} /></button>
        </form><p className="login-note">¿Necesitas acceso? Solicítalo al administrador de tu academia.</p>
      </div>
      <footer className="entry-footer"><span>PADDOCK · ACADEMIAS</span><span>ACCESO SEGURO</span></footer>
    </section>
  </main>;
}

function RecordForm({ record, academies, onClose, onSave }: {
  record: RecordDraft;
  academies: Academy[];
  onClose: () => void;
  onSave: (record: RecordDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(record);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function update(key: keyof RecordDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function updateNumber(key: keyof RecordDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value === "" ? null : Number(value) }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(draft); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No fue posible guardar"); }
    finally { setBusy(false); }
  }
  return <Modal title={draft.id ? "Editar registro" : "Nuevo alumno"} onClose={onClose}>
    <form className="data-form" onSubmit={(event) => void submit(event)}><div className="form-grid">
      <label>Academia<select value={draft.academy_id} onChange={(event) => update("academy_id", event.target.value)} required>{academies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Fecha<input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></label>
      <label className="wide-field">Nombres completos<input autoFocus value={draft.full_name} onChange={(event) => update("full_name", event.target.value)} required maxLength={500} /></label>
      <label>Tipo de documento<select value={draft.document_type} onChange={(event) => update("document_type", event.target.value)}><option value="">Seleccionar</option>{["CC", "TI", "CE", "PPT", "PE"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Número de documento<input value={draft.document_number} onChange={(event) => update("document_number", event.target.value)} /></label>
      <label>Número de orden<input value={draft.order_number} onChange={(event) => update("order_number", event.target.value)} /></label>
      <label>Asesor<input value={draft.advisor} onChange={(event) => update("advisor", event.target.value)} /></label>
      <label>Tipo de trámite<select value={draft.procedure} onChange={(event) => update("procedure", event.target.value)}><option value="">Seleccionar</option>{["PRIMERA VEZ", "RECATEGORIZACION", "REFRENDACION"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Categoría<input value={draft.category} onChange={(event) => update("category", event.target.value)} placeholder="A2, B1, C1..." /></label>
      <label>Forma de pago<input value={draft.payment_method} onChange={(event) => update("payment_method", event.target.value)} /></label>
      <label>Estado de pago CRC<select value={draft.payment_crc_status} onChange={(event) => update("payment_crc_status", event.target.value)}><option value="">Pendiente</option><option>PAGA</option><option>DEBE</option></select></label>
      <label>Estado QPL<select value={draft.qpl_status} onChange={(event) => update("qpl_status", event.target.value)}><option value="">Pendiente</option><option>PAGA</option><option>DEBE</option></select></label>
      <label>Costo lámina<input type="number" min="0" step="100" value={draft.sheet_cost ?? ""} onChange={(event) => updateNumber("sheet_cost", event.target.value)} /></label>
      <label>Costo QPL<input type="number" min="0" step="100" value={draft.qpl_cost ?? ""} onChange={(event) => updateNumber("qpl_cost", event.target.value)} /></label>
      <label>Valor a consignar<input type="number" min="0" step="100" value={draft.amount_due ?? ""} onChange={(event) => updateNumber("amount_due", event.target.value)} /></label>
      <label>Examen médico<input type="number" min="0" step="100" value={draft.medical_exam_cost ?? ""} onChange={(event) => updateNumber("medical_exam_cost", event.target.value)} /></label>
      <label className="wide-field">Observaciones<textarea rows={3} value={draft.observations} onChange={(event) => update("observations", event.target.value)} maxLength={500} /></label>
    </div>{error && <p className="form-error" role="alert"><CircleAlert size={15} />{error}</p>}
    <footer className="form-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? "Guardando..." : "Guardar registro"}</button></footer></form>
  </Modal>;
}

function RecordDetails({ record, canEdit, onClose, onEdit }: {
  record: StudentRecord;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const fields = [
    ["Academia", record.academy_name],
    ["Fecha", formatDate(record.date)],
    ["Número de orden", record.order_number],
    ["Asesor", record.advisor],
    ["Tipo de documento", record.document_type],
    ["Número de documento", record.document_number],
    ["Tipo de trámite", record.procedure],
    ["Categoría", record.category],
    ["Forma de pago", record.payment_method],
    ["Estado de pago CRC", record.payment_crc_status],
    ["Estado QPL", record.qpl_status],
    ["Costo lámina", formatCurrency(record.sheet_cost)],
    ["Costo QPL", formatCurrency(record.qpl_cost)],
    ["Valor a consignar", formatCurrency(record.amount_due)],
    ["Costo examen médico", formatCurrency(record.medical_exam_cost)],
  ] as const;
  return <Modal title="Ficha del alumno" onClose={onClose}>
    <div className="record-details"><div className="detail-name"><p className="eyebrow">{record.procedure || "TRÁMITE"} · {record.category || "SIN CATEGORÍA"}</p><h3>{record.full_name}</h3></div>
      <dl className="detail-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>
      <div className="detail-observations"><span>Observaciones</span><p>{record.observations || "Sin observaciones"}</p></div>
      {canEdit && <footer className="form-actions"><button className="button button-primary" onClick={onEdit}>Editar registro</button></footer>}
    </div>
  </Modal>;
}

function ImportPage({ academies, onImported, onError }: {
  academies: Academy[];
  onImported: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [academyId, setAcademyId] = useState(academies[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  async function inspect() {
    if (!file || !academyId) return;
    setBusy(true);
    try { setPreview(await api.previewImport(file, academyId)); }
    catch (cause) { onError(cause instanceof Error ? cause.message : "No se pudo leer el archivo"); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!file || !academyId) return;
    setBusy(true);
    try {
      const result = await api.commitImport(file, academyId);
      onImported(`${result.imported} importados · ${result.skipped} duplicados omitidos · ${result.invalid} filas con errores`);
    } catch (cause) { onError(cause instanceof Error ? cause.message : "No se pudo completar la importación"); }
    finally { setBusy(false); }
  }
  return <section className="admin-page import-page">
    <div className="page-heading"><div><p className="eyebrow">CARGA INICIAL</p><h1>Importar registros</h1><p className="page-subtitle">Carga un archivo a una academia específica.</p></div><span className="private-tag"><ShieldCheck size={15} /> IMPORTACIÓN PRIVADA</span></div>
    <section className="import-workflow"><div className="workflow-step"><span className="step-number">01</span><div><strong>Academia de destino</strong><p>Los datos se asignarán únicamente a la seleccionada.</p></div></div>
      <label className="select-wrap import-academy"><span className="sr-only">Academia de destino</span><select value={academyId} onChange={(event) => { setAcademyId(event.target.value); setPreview(null); }}><option value="">Seleccionar academia</option>{academies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><ChevronDown size={14} /></label>
      <div className="workflow-step"><span className="step-number">02</span><div><strong>Archivo CSV o XLSX</strong><p>Máximo 5 MB. Se reconocen encabezados de la hoja compartida.</p></div></div>
      <label className={`drop-zone ${file ? "drop-zone-selected" : ""}`}><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /><span className="drop-icon"><FileSpreadsheet size={22} /></span><span className="drop-copy"><strong>{file?.name ?? "Selecciona un archivo para cargar"}</strong><small>{file ? `${(file.size / 1024).toFixed(0)} KB · Listo para revisar` : "o arrástralo aquí · CSV / XLSX"}</small></span><span className="button button-quiet">Examinar</span></label>
      <div className="workflow-actions"><button className="button button-primary" disabled={!file || !academyId || busy} onClick={() => void inspect()}>{busy ? "Revisando..." : "Revisar archivo"}<ArrowRight size={16} /></button></div>
    </section>
    {preview && <section className="preview-section"><div className="preview-heading"><div><p className="eyebrow">PASO 03 · VALIDACIÓN</p><h2>Vista previa</h2></div><div className="preview-stats"><span><strong>{preview.valid}</strong> listas</span><span><strong>{preview.duplicates}</strong> duplicadas</span><span><strong>{preview.invalid}</strong> con errores</span></div></div>
      <div className="table-scroll"><table className="records-table preview-table"><thead><tr><th>FILA</th><th>ALUMNO</th><th>DOCUMENTO</th><th>TRÁMITE</th><th>VALOR</th><th>RESULTADO</th></tr></thead><tbody>{preview.rows.slice(0, 15).map((row) => <tr key={row.source_row}><td>{row.source_row}</td><td>{row.record?.full_name ?? "—"}</td><td>{row.record?.document_number || "—"}</td><td>{row.record?.procedure || "—"}</td><td>{formatCurrency(row.record?.amount_due ?? null)}</td><td>{row.error ? <span className="status-badge status-due"><span />{row.error}</span> : row.duplicate ? <span className="status-badge status-pending"><span />Duplicado</span> : <span className="status-badge status-paid"><span />Listo</span>}</td></tr>)}</tbody></table></div>
      {preview.rows.length > 15 && <p className="preview-more">Se muestran 15 de {preview.rows.length} filas validadas.</p>}
      <footer className="form-actions"><span className="field-hint">Las filas inválidas y duplicadas no se importarán.</span><button className="button button-primary" disabled={busy || preview.valid === 0} onClick={() => void commit()}>{busy ? "Importando..." : `Importar ${preview.valid} registros`}<ArrowRight size={16} /></button></footer>
    </section>}
    <aside className="import-notice"><CircleAlert size={17} /><p>Revisa que el archivo pertenezca a la academia seleccionada. Los datos de identificación y pagos se almacenan de forma privada.</p></aside>
  </section>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>("records");
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [users, setUsers] = useState<AcademyUser[]>([]);
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<StudentRecord | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [academyId, setAcademyId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"record" | "academy" | "user" | null>(null);
  const [editing, setEditing] = useState<RecordDraft | null>(null);
  const [editingUser, setEditingUser] = useState<AcademyUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const admin = user?.role === "admin";
  const canWrite = admin || user?.can_write === true;
  const pageSize = 50;

  useEffect(() => {
    let alive = true;
    void api.me().then(({ user: current }) => { if (alive) setUser(current); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search.trim()) query.set("search", search.trim());
    if (academyId && admin) query.set("academyId", academyId);
    if (paymentStatus) query.set("paymentStatus", paymentStatus);
    void api.records(query).then((result) => {
      if (alive) { setRecords(result.records); setTotal(result.total); }
    }).catch((cause: unknown) => { if (alive) setNotice(cause instanceof Error ? cause.message : "No se pudieron cargar los registros"); });
    return () => { alive = false; };
  }, [academyId, admin, page, paymentStatus, search, user]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void Promise.all([api.academies(), ...(admin ? [api.users()] : [])]).then(([academyResult, userResult]) => {
      if (!alive) return;
      setAcademies(academyResult.academies);
      if (userResult) setUsers(userResult.users);
    }).catch((cause: unknown) => { if (alive) setNotice(cause instanceof Error ? cause.message : "No se pudo cargar el panel"); });
    return () => { alive = false; };
  }, [admin, user]);

  function refreshRecords() {
    setPage(1);
    const query = new URLSearchParams({ page: "1", pageSize: String(pageSize) });
    if (search.trim()) query.set("search", search.trim());
    if (academyId && admin) query.set("academyId", academyId);
    if (paymentStatus) query.set("paymentStatus", paymentStatus);
    void api.records(query).then((result) => { setRecords(result.records); setTotal(result.total); })
      .catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : "No se pudieron cargar los registros"));
  }

  async function saveRecord(record: RecordDraft) {
    if (record.id) {
      await api.updateRecord(record as RecordDraft & { id: string });
      setNotice("Registro actualizado");
    } else {
      await api.createRecord(record);
      setNotice("Alumno agregado");
    }
    setEditing(null); refreshRecords();
  }

  async function createAcademy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    try {
      const { academy } = await api.createAcademy(String(form.get("name") ?? ""), String(form.get("city") ?? ""));
      setAcademies((current) => [...current, academy].sort((a, b) => a.name.localeCompare(b.name)));
      setAcademyId(academy.id); setNotice("Academia creada"); setModal(null);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "No se pudo crear la academia"); }
    finally { setBusy(false); }
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    const academyIds = form.getAll("academyIds").map(String);
    const password = String(form.get("password") ?? "");
    const canWrite = form.get("canWrite") === "true";
    try {
      if (editingUser) {
        await api.updateUser(editingUser.id, academyIds, Boolean(editingUser.active), canWrite, password);
        setUsers((current) => current.map((entry) => entry.id === editingUser.id
          ? { ...entry, academy_ids: academyIds, can_write: canWrite }
          : entry));
        setNotice("Acceso actualizado");
      } else {
        const result = await api.createUser(String(form.get("username") ?? ""), password, academyIds, canWrite);
        setUsers((current) => [...current, result.user]); setNotice("Usuario creado");
      }
      setEditingUser(null); setModal(null);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "No se pudo guardar el usuario"); }
    finally { setBusy(false); }
  }

  async function changeViewer(entry: AcademyUser) {
    const active = !entry.active;
    try {
      await api.updateUser(entry.id, entry.academy_ids, active, entry.can_write);
      setUsers((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, active: Number(active) } : candidate));
      setNotice(active ? "Acceso reactivado" : "Acceso revocado y sesiones cerradas");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "No se pudo actualizar el acceso"); }
  }

  async function logout() {
    try { await api.logout(); } finally { setUser(null); setAcademies([]); setUsers([]); setRecords([]); }
  }

  if (checking) return <div className="boot-screen"><span className="brand-mark"><Flag size={18} /></span><span>Cargando portal</span></div>;
  if (!user) return <Login onLogin={(nextUser) => {
    setUser(nextUser);
    setView("records");
    setPage(1);
    setSearch("");
    setAcademyId("");
    setPaymentStatus("");
  }} />;

  const nav: Array<{ id: View; label: string; icon: typeof Gauge; adminOnly?: boolean }> = [
    { id: "records", label: "Alumnos y trámites", icon: Gauge },
    { id: "academies", label: "Academias", icon: Building2, adminOnly: true },
    { id: "users", label: "Usuarios", icon: UsersRound, adminOnly: true },
    { id: "import", label: "Importar datos", icon: FileSpreadsheet },
  ];
  const visibleNav = nav.filter((item) =>
    (!item.adminOnly || admin) && (item.id !== "import" || canWrite),
  );

  return <div className="workspace-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <a className="side-brand" href="#inicio" onClick={(event) => { event.preventDefault(); setView("records"); }}><span className="brand-mark"><Flag size={17} /></span><span>PADDOCK</span></a>
      <div className="side-kicker">CENTRO DE OPERACIONES</div>
      <nav className="side-nav" aria-label="Navegación principal">{visibleNav.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "nav-active" : ""}`} onClick={() => { setView(id); setMobileNav(false); }}><Icon size={17} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="profile-card"><span className="avatar">{user.username.slice(0, 1).toLocaleUpperCase("es-CO")}</span><span className="profile-copy"><strong>{user.username}</strong><small>{admin ? "Administrador" : canWrite ? "Carga y edición" : "Solo lectura"}</small></span><button className="icon-button profile-logout" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => void logout()}><LogOut size={16} /></button></div><div className="privacy-note"><ShieldCheck size={14} /><span>Datos privados<br />por academia</span></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Abrir navegación" onClick={() => setMobileNav((value) => !value)}><Menu size={19} /></button><div className="breadcrumbs"><span>PADDOCK</span><span className="crumb-separator">/</span><strong>{visibleNav.find((item) => item.id === view)?.label}</strong></div><div className="topbar-right"><span className="live-indicator"><span /> SISTEMA ACTIVO</span><span className="topbar-user">{user.username.slice(0, 1).toLocaleUpperCase("es-CO")}</span></div></header>
      <div className="page-content">
        {notice && <div className="notice-banner" role="status"><span><Check size={16} />{notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16} /></button></div>}
        {view === "records" && <>
          <section className="page-heading"><div><p className="eyebrow">PANEL DE CONTROL <span className="heading-dot">·</span> {formatDate(new Date().toISOString())}</p><h1>Alumnos y trámites</h1><p className="page-subtitle">Consulta y seguimiento de registros por academia.</p></div><div className="heading-actions">{canWrite && <button className="button button-quiet" onClick={() => setView("import")}><FileSpreadsheet size={16} /> Importar</button>}{canWrite && <button className="button button-primary" onClick={() => { setEditing(null); setModal("record"); }}><Plus size={17} /> Nuevo alumno</button>}</div></section>
          <section className="metric-strip"><div className="metric-cell"><span className="metric-label">REGISTROS EN VISTA</span><strong>{total.toLocaleString("es-CO")}</strong><small>Coincidencias actuales</small></div><div className="metric-cell"><span className="metric-label">ACADEMIAS</span><strong>{academies.length.toLocaleString("es-CO")}</strong><small>{academyId ? academies.find((a) => a.id === academyId)?.name : "Todas las academias asignadas"}</small></div><div className="metric-cell"><span className="metric-label">PÁGINA</span><strong>{String(page).padStart(2, "0")}<span className="metric-divider">/</span>{String(Math.max(1, Math.ceil(total / pageSize))).padStart(2, "0")}</strong><small>Hasta 50 registros por página</small></div><div className="metric-stamp"><Gauge size={18} /><span>VISTA<br />ACTUALIZADA</span></div></section>
          <section className="records-section"><div className="section-header"><div><h2>Registro de alumnos</h2><p>{total.toLocaleString("es-CO")} resultados encontrados</p></div></div>
            <div className="filter-bar"><label className="search-field"><Search size={17} /><input aria-label="Buscar alumnos" placeholder="Buscar por nombre, documento u orden" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /><kbd>/</kbd></label>
              {admin && <label className="select-wrap"><span className="sr-only">Filtrar por academia</span><select value={academyId} onChange={(event) => { setPage(1); setAcademyId(event.target.value); }}><option value="">Todas las academias</option>{academies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><ChevronDown size={14} /></label>}
              <label className="select-wrap"><span className="sr-only">Estado de pago</span><select value={paymentStatus} onChange={(event) => { setPage(1); setPaymentStatus(event.target.value); }}><option value="">Todos los pagos</option><option value="PAGA">Pagado</option><option value="DEBE">Pendiente</option></select><ChevronDown size={14} /></label>
            </div>
            <div className="table-scroll"><table className="records-table"><thead><tr><th>FECHA</th><th>ALUMNO</th><th>TRÁMITE</th>{admin && <th>ACADEMIA</th>}<th>ESTADO DE PAGO</th><th>VALOR</th>{canWrite && <th />}</tr></thead><tbody>
              {records.map((record) => <tr key={record.id}><td className="date-cell">{formatDate(record.date)}<span>Orden {record.order_number || "—"}</span></td><td><button className="person-name" onClick={() => setSelectedRecord(record)}>{record.full_name}</button><span className="person-document">{record.document_type} {record.document_number || "Sin documento"}</span></td><td><strong className="procedure-name">{record.procedure || "Sin trámite"}</strong><span className="person-document">Categoría {record.category || "—"}</span></td>{admin && <td className="academy-cell">{record.academy_name}</td>}<td><span className={`status-badge ${record.payment_crc_status === "PAGA" ? "status-paid" : record.payment_crc_status === "DEBE" ? "status-due" : "status-pending"}`}><span />{record.payment_crc_status === "PAGA" ? "Pagado" : record.payment_crc_status === "DEBE" ? "Pendiente" : "Sin estado"}</span></td><td className="amount-cell">{formatCurrency(record.amount_due)}</td>              {canWrite && <td><button className="icon-button row-action" aria-label={`Editar a ${record.full_name}`} onClick={() => { setEditing({ ...record }); setModal("record"); }}><ArrowUpRight size={16} /></button></td>}</tr>)}
              {!records.length && <tr><td colSpan={5 + Number(admin) + Number(canWrite)} className="empty-row">{search || academyId || paymentStatus ? "No hay registros que coincidan con estos filtros." : "Aún no hay registros. Agrega un alumno o importa una hoja."}</td></tr>}
            </tbody></table></div>
            <footer className="table-footer"><span>Mostrando {records.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} de {total.toLocaleString("es-CO")}</span><div className="pagination"><button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>{page}</span><button className="button button-quiet" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div></footer>
          </section>
        </>}
        {view === "academies" && admin && <section className="admin-page"><div className="page-heading"><div><p className="eyebrow">ESTRUCTURA DE LA RED</p><h1>Academias</h1><p className="page-subtitle">Administra los centros y sus registros.</p></div><button className="button button-primary" onClick={() => setModal("academy")}><Plus size={17} /> Añadir academia</button></div><div className="admin-list-heading"><h2>Centros registrados</h2><span>{academies.length} academias</span></div><div className="academy-list">{academies.map((academy, index) => <article className="academy-row" key={academy.id}><span className="academy-index">{String(index + 1).padStart(2, "0")}</span><span className="academy-icon"><Building2 size={18} /></span><div className="academy-info"><strong>{academy.name}</strong><span>{academy.city || "Ubicación no registrada"}</span></div><button className="button button-quiet" onClick={() => { setAcademyId(academy.id); setView("records"); }}>Ver registros<ArrowRight size={15} /></button></article>)}</div>{!academies.length && <div className="empty-panel">Añade la primera academia para comenzar.</div>}</section>}
        {view === "users" && admin && <section className="admin-page"><div className="page-heading"><div><p className="eyebrow">CONTROL DE ACCESO</p><h1>Usuarios</h1><p className="page-subtitle">Gestiona usuarios, permisos y academias asignadas.</p></div><button className="button button-primary" onClick={() => { setEditingUser(null); setModal("user"); }}><Plus size={17} /> Crear usuario</button></div><div className="admin-list-heading"><h2>Accesos asignados</h2><span>{users.length} usuarios</span></div><div className="user-list">{users.map((entry) => <article className="user-row" key={entry.id}><span className="avatar user-avatar">{entry.username.slice(0, 1).toLocaleUpperCase("es-CO")}</span><div className="user-info"><strong>{entry.username}</strong><span>{entry.can_write ? "Carga y edición" : "Solo lectura"} · {entry.academy_ids.map((id) => academies.find((a) => a.id === id)?.name).filter(Boolean).join(" · ") || "Sin academias"}</span></div><span className={`user-state ${entry.active ? "" : "user-disabled"}`}><span />{entry.active ? "Activo" : "Desactivado"}</span><button className="button button-quiet" onClick={() => { setEditingUser(entry); setModal("user"); }}>Editar acceso</button><button className="button button-quiet" onClick={() => void changeViewer(entry)}>{entry.active ? "Revocar" : "Reactivar"}</button></article>)}</div>{!users.length && <div className="empty-panel">Crea cuentas y asigna permisos de consulta o carga.</div>}</section>}
        {view === "import" && canWrite && <ImportPage academies={academies} onError={setNotice} onImported={(message) => { setNotice(message); setView("records"); refreshRecords(); }} />}
      </div>
    </main>
    {mobileNav && <button className="mobile-scrim" aria-label="Cerrar navegación" onClick={() => setMobileNav(false)} />}
    {modal === "record" && academies.length > 0 && <RecordForm record={editing ?? emptyRecord(academyId || academies[0]!.id)} academies={academies} onClose={() => { setModal(null); setEditing(null); }} onSave={saveRecord} />}
    {selectedRecord && <RecordDetails record={selectedRecord} canEdit={canWrite} onClose={() => setSelectedRecord(null)} onEdit={() => { setEditing({ ...selectedRecord }); setSelectedRecord(null); setModal("record"); }} />}
    {modal === "academy" && <Modal title="Añadir academia" onClose={() => setModal(null)}><form className="data-form compact-form" onSubmit={(event) => void createAcademy(event)}><label>Nombre de la academia<input autoFocus name="name" required maxLength={120} placeholder="Academia Central" /></label><label>Ciudad o sede<input name="city" maxLength={120} placeholder="Bogotá" /></label><footer className="form-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? "Creando..." : "Crear academia"}</button></footer></form></Modal>}
    {modal === "user" && <Modal title={editingUser ? "Editar acceso" : "Crear usuario"} onClose={() => { setModal(null); setEditingUser(null); }}><form className="data-form compact-form" onSubmit={(event) => void saveUser(event)}><p className="modal-description">Elige si la cuenta solo consulta o también registra y edita alumnos en las academias asignadas.</p>{editingUser ? <><label>Nombre de usuario<input value={editingUser.username} readOnly /></label><label>Nueva contraseña <span className="field-hint">Déjala vacía para conservar la actual.</span><input name="password" type="password" minLength={12} maxLength={256} autoComplete="new-password" /></label></> : <><label>Nombre de usuario<input autoFocus name="username" required minLength={3} maxLength={100} autoComplete="off" /></label><label>Contraseña temporal<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /><span className="field-hint">Mínimo 12 caracteres. Entrégala por un canal seguro.</span></label></>}<label>Permiso<select name="canWrite" defaultValue={editingUser?.can_write ? "true" : "false"}><option value="false">Solo lectura</option><option value="true">Carga y edición de alumnos</option></select></label><fieldset className="academy-checks"><legend>Academias permitidas</legend>{academies.map((academy) => <label key={academy.id}><input type="checkbox" name="academyIds" value={academy.id} defaultChecked={editingUser?.academy_ids.includes(academy.id)} />{academy.name}</label>)}</fieldset><footer className="form-actions"><button type="button" className="button button-quiet" onClick={() => { setModal(null); setEditingUser(null); }}>Cancelar</button><button className="button button-primary" disabled={busy || !academies.length}>{busy ? "Guardando..." : editingUser ? "Guardar acceso" : "Crear usuario"}</button></footer></form></Modal>}
  </div>;
}