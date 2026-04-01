
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CatalogItem,
  ContextAttachment,
  FileTreeNode,
  ProviderHealth,
  RunEvent,
  RunPromptOption,
  SessionRecord,
  SyncJobRecord,
  SyncSource,
  WorkspaceSnapshot
} from "@shared/types";

type View = "chat" | "sessions" | "catalog";

interface BootstrapPayload {
  sessions: SessionRecord[];
  health: ProviderHealth;
  catalog: {
    items: CatalogItem[];
    sources: SyncSource[];
    jobs: SyncJobRecord[];
  };
}

const starterPrompts = [
  "Summarize this workspace and suggest the safest first change.",
  "Explain the latest agent session in plain language.",
  "Draft a plan for adding a new skill to this app."
];

const workspaceStorageKey = "command-foundry:workspace-root";

const catalogGuide = [
  {
    title: "Skills",
    blurb: "Reusable task patterns that shape prompts, workflows, and output style.",
    steps: [
      "Enable a skill, then ask for the task directly in chat.",
      "Mention the outcome you want, the workspace it applies to, and any files to inspect.",
      "Use skills when you want repeatable behavior like planning, summarizing, scaffolding, or document generation."
    ]
  },
  {
    title: "Agents",
    blurb: "Higher-level specialists that can own a broader workflow across multiple turns.",
    steps: [
      "Open a workspace first so the agent is grounded in the right project.",
      "Use agents for larger tasks like repo analysis, feature delivery, or structured reviews.",
      "Reopen past sessions to continue where an agent left off."
    ]
  },
  {
    title: "MCP",
    blurb: "Model Context Protocol integrations that let the app connect to external tools or richer local context.",
    steps: [
      "Use MCP when a task needs data beyond the current workspace, like services, docs, or local tool integrations.",
      "Keep connections explicit and scoped so the model only sees what it needs.",
      "Treat MCP as infrastructure for skills and agents, not as a chat destination by itself."
    ]
  }
] as const;

const navItems: Array<{ view: View; label: string; icon: (active: boolean) => ReactNode }> = [
  { view: "chat", label: "Chat", icon: (active) => <ChatIcon active={active} /> },
  { view: "sessions", label: "Sessions", icon: (active) => <HistoryIcon active={active} /> },
  { view: "catalog", label: "Catalog", icon: (active) => <LibraryIcon active={active} /> }
];

export function App() {
  const [view, setView] = useState<View>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [catalog, setCatalog] = useState<BootstrapPayload["catalog"]>({ items: [], sources: [], jobs: [] });
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | undefined>();
  const [workspaceTree, setWorkspaceTree] = useState<FileTreeNode[]>([]);
  const [busy, setBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ runId: string; promptId: string; message: string; options?: RunPromptOption[] } | null>(null);
  const [promptInput, setPromptInput] = useState("");

  useEffect(() => {
    // Renderer bootstrap intentionally hydrates the whole shell in one step so
    // the activity bar, header, and flyouts all start from the same snapshot.
    void window.friendlyAgent.bootstrap().then((payload: BootstrapPayload) => {
      setSessions(payload.sessions);
      setHealth(payload.health);
      setCatalog(payload.catalog);
      setActiveSessionId(payload.sessions[0]?.id);
    });
  }, []);

  useEffect(() => {
    // The last selected workspace is persisted locally because it doubles as
    // both an explorer root and the default cwd for future CLI runs.
    const savedWorkspace = window.localStorage.getItem(workspaceStorageKey);
    if (!savedWorkspace) {
      return;
    }
    void window.friendlyAgent.getWorkspaceTree(savedWorkspace).then((snapshot) => {
      const workspace = snapshot as WorkspaceSnapshot;
      setWorkspaceRoot(workspace.rootPath);
      setWorkspaceTree(workspace.tree);
    });
  }, []);

  useEffect(() => {
    return window.friendlyAgent.onRunEvent((event) => {
      const runEvent = event as RunEvent;
      // Session history is refreshed alongside the live transcript so sidebar
      // lists and the active thread stay in sync during streaming runs.
      void refreshSessions();
      if (runEvent.type === "prompt") {
        setPendingPrompt({
          runId: runEvent.runId,
          promptId: runEvent.promptId,
          message: runEvent.message,
          options: runEvent.options
        });
      }
      if (runEvent.type === "completed" || runEvent.type === "failed" || runEvent.type === "cancelled") {
        setBusy(false);
        setPendingPrompt((current) => (current?.runId === runEvent.runId ? null : current));
        setPromptInput("");
      }
    });
  }, []);

  const activeSession = useMemo(() => sessions.find((session) => session.id === activeSessionId), [sessions, activeSessionId]);
  const skillItems = useMemo(() => catalog.items.filter((item) => item.kind === "skill"), [catalog.items]);
  const agentItems = useMemo(() => catalog.items.filter((item) => item.kind === "agent"), [catalog.items]);
  const mcpSources = useMemo(
    () => catalog.sources.filter((source) => `${source.title} ${source.url} ${source.manifestPath}`.toLowerCase().includes("mcp")),
    [catalog.sources]
  );
  const currentMessages = activeSession?.messages ?? [];
  const attachmentCount = attachments.length || activeSession?.attachments.length || 0;

  async function refreshSessions() {
    const next = (await window.friendlyAgent.listSessions()) as SessionRecord[];
    setSessions(next);
    setActiveSessionId((current) => current ?? next[0]?.id);
  }

  async function refreshCatalog() {
    const next = (await window.friendlyAgent.listCatalog()) as BootstrapPayload["catalog"];
    setCatalog(next);
  }

  async function sendMessage(prefill?: string) {
    const prompt = (prefill ?? composer).trim();
    if (!prompt) {
      return;
    }
    setBusy(true);
    const session = (await window.friendlyAgent.sendMessage({
      threadId: activeSessionId,
      prompt,
      attachments,
      workspaceRoot
    })) as SessionRecord;
    setComposer("");
    setAttachments([]);
    await refreshSessions();
    // The chat shell always returns to the active run after launching from a
    // starter prompt, catalog shortcut, or session reopen flow.
    setActiveSessionId(session.id);
    setView("chat");
  }

  async function startLogin() {
    setBusy(true);
    setAuthNotice(
      health?.cliInstalled
        ? "Opening GitHub CLI sign-in. If a one-time code is copied to your clipboard, paste it at https://github.com/login/device."
        : "GitHub CLI is not installed yet. Command Foundry will download a supported version, then hand off sign-in to the CLI."
    );
    try {
      const nextAuth = (await window.friendlyAgent.startLogin()) as ProviderHealth["authState"];
      const providerHealth = (await window.friendlyAgent.checkProviderHealth()) as ProviderHealth;
      setHealth({ ...providerHealth, authState: nextAuth });
      setAuthNotice(
        nextAuth.status === "authenticated"
          ? `Signed in${nextAuth.username ? ` as ${nextAuth.username}` : ""}.`
          : nextAuth.detail ?? "GitHub sign-in did not complete."
      );
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function relaunchElevated() {
    await window.friendlyAgent.relaunchElevated();
  }

  async function createSession() {
    const created = (await window.friendlyAgent.createSession()) as SessionRecord;
    await refreshSessions();
    setActiveSessionId(created.id);
    setView("chat");
  }

  async function openSession(id: string) {
    const opened = (await window.friendlyAgent.openSession(id)) as SessionRecord | undefined;
    if (!opened) {
      return;
    }
    setActiveSessionId(opened.id);
    if (opened.workspaceRoot) {
      setWorkspaceRoot(opened.workspaceRoot);
      window.localStorage.setItem(workspaceStorageKey, opened.workspaceRoot);
      const snapshot = (await window.friendlyAgent.getWorkspaceTree(opened.workspaceRoot)) as WorkspaceSnapshot;
      setWorkspaceTree(snapshot.tree);
    }
    setView("chat");
  }

  async function pickFiles() {
    const picked = (await window.friendlyAgent.pickFiles()) as ContextAttachment[];
    setAttachments((current) => [...current, ...picked]);
  }

  async function pickFolder() {
    const picked = (await window.friendlyAgent.pickFolder()) as ContextAttachment[];
    setAttachments((current) => [...current, ...picked]);
  }

  async function pickWorkspace() {
    const snapshot = (await window.friendlyAgent.pickWorkspace()) as WorkspaceSnapshot;
    setWorkspaceRoot(snapshot.rootPath);
    setWorkspaceTree(snapshot.tree);
    if (snapshot.rootPath) {
      window.localStorage.setItem(workspaceStorageKey, snapshot.rootPath);
    }
  }

  async function submitCliPrompt(input: string) {
    if (!pendingPrompt) {
      return;
    }
    await window.friendlyAgent.submitPrompt({ runId: pendingPrompt.runId, input });
    setPendingPrompt(null);
    setPromptInput("");
  }

  async function syncSource(sourceId: string) {
    setBusy(true);
    setCatalogNotice(null);
    try {
      await window.friendlyAgent.syncSource(sourceId);
      await refreshCatalog();
      setCatalogNotice("Catalog sync completed.");
    } catch (error) {
      setCatalogNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCatalogItem(itemId: string, enabled: boolean) {
    await window.friendlyAgent.toggleCatalogItem({ itemId, enabled });
    await refreshCatalog();
  }

  function useCatalogItem(item: CatalogItem) {
    // Catalog entries are prompt accelerators today; they seed the composer
    // with structured intent while keeping the user in the same chat surface.
    const prompt = item.kind === "skill"
      ? `Use the ${item.title} skill in this workspace. ${item.description}`
      : `Act as the ${item.title} agent for this workspace. ${item.description}`;
    setComposer(prompt);
    setView("chat");
  }
  return (
    <div className="h-screen overflow-hidden bg-[#f5f5f5] text-[#1f1f1f]">
      <div
        className="grid h-full min-h-0 transition-[grid-template-columns] duration-200 ease-out"
        style={{ gridTemplateColumns: sidebarOpen ? "48px 320px minmax(0,1fr)" : "48px 0px minmax(0,1fr)" }}
      >
        <aside className="flex h-full min-h-0 flex-col border-r border-[#2a2d2e] bg-[#181a1b] text-[#9da1a6]">
          <div className="flex h-12 items-center justify-center border-b border-[#2a2d2e]">
            <img className="h-7 w-7 rounded-md object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" src="/app-icon.ico?v=command-foundry-2" alt="Command Foundry" />
          </div>
          <nav className="flex flex-1 flex-col items-center gap-1 py-3">
            {navItems.map((item) => {
              const active = view === item.view;
              return (
                <button
                  key={item.view}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-md transition duration-150 ${active ? "bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "text-[#8e9399] hover:bg-white/6 hover:text-white"}`}
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => {
                    setView(item.view);
                    setSidebarOpen(true);
                  }}
                >
                  {active && <span className="absolute left-[-6px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#f5f5f5]" />}
                  {item.icon(active)}
                </button>
              );
            })}
          </nav>
          <div className="flex flex-col items-center gap-2 border-t border-[#2a2d2e] py-2">
            <button
              className="flex h-10 w-10 items-center justify-center rounded-md text-[#8e9399] transition hover:bg-white/6 hover:text-white"
              title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              onClick={() => setSidebarOpen((current) => !current)}
            >
              <PanelToggleIcon collapsed={!sidebarOpen} />
            </button>
          </div>
        </aside>

        <aside className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f8f8f8] transition-[opacity,border-color] duration-200 ease-out ${sidebarOpen ? "border-r border-[#dadada] opacity-100" : "border-r border-transparent opacity-0"}`}>
          <div className={`flex h-full min-h-0 min-w-0 flex-col transition-[transform,opacity] duration-200 ease-out ${sidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0 pointer-events-none"}`}>
            <div className="border-b border-[#e4e4e4] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7a7a7a]">{drawerLabel(view)}</p>
                  <h1 className="mt-1 truncate text-[15px] font-semibold text-[#1f1f1f]">{drawerTitle(view)}</h1>
                  <p className="mt-1 text-xs leading-5 text-[#6a6a6a]">{drawerSubtitle(view)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded-md border border-[#d4d4d4] bg-white px-2.5 py-1 text-xs font-medium text-[#2d2d2d] hover:bg-[#fbfbfb]" onClick={createSession}>
                    New
                  </button>
                  <button className="rounded-md border border-[#d4d4d4] bg-white px-2.5 py-1 text-xs font-medium text-[#2d2d2d] hover:bg-[#fbfbfb]" onClick={() => setSidebarOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>

            {view === "chat" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <section className="border-b border-[#e3e3e3] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">Workspace</span>
                    <button className="rounded-md border border-[#d8d8d8] bg-white px-2.5 py-1 text-xs font-medium text-[#2e2e2e] hover:bg-[#fafafa]" onClick={pickWorkspace}>
                      {workspaceRoot ? "Change" : "Choose"}
                    </button>
                  </div>
                  <p className="truncate text-sm font-semibold text-[#1f1f1f]">{workspaceRoot?.split(/[\\/]/).at(-1) ?? "No workspace selected"}</p>
                  <p className="mt-1 break-all text-xs leading-5 text-[#6d6d6d]">{workspaceRoot ?? "Pick a project folder to populate the explorer and bind the CLI to that workspace."}</p>
                </section>

                <section className="flex min-h-0 flex-1 flex-col px-4 py-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">Explorer</span>
                    <span className="rounded-full bg-[#ececec] px-2 py-0.5 text-[11px] font-medium text-[#6d6d6d]">{workspaceTree.length}</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto pr-1">
                    {workspaceTree.length > 0 ? <FileTree nodes={workspaceTree} depth={0} /> : <div className="rounded-xl border border-dashed border-[#dadada] bg-white px-3 py-4 text-sm text-[#6e6e6e]">Choose a workspace to show its files.</div>}
                  </div>
                </section>

                <section className="border-t border-[#e3e3e3] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">System</span>
                    <span className="rounded-full bg-[#ececec] px-2 py-0.5 text-[11px] font-medium capitalize text-[#5f5f5f]">{health?.authState.status ?? "unknown"}</span>
                  </div>
                  <div className="space-y-2 text-sm text-[#5d5d5d]">
                    <div className="flex items-center justify-between"><span>CLI</span><strong className="font-medium text-[#1f1f1f]">{health?.cliVersion ?? "not found"}</strong></div>
                    <div className="flex items-center justify-between"><span>Support</span><strong className="font-medium text-[#1f1f1f]">{health?.supportedVersionRange ?? "checking"}</strong></div>
                    <div className="flex items-center justify-between"><span>Copilot</span><strong className="font-medium text-[#1f1f1f]">{health?.copilotAvailable ? "Ready" : "Needs setup"}</strong></div>
                    <div className="flex items-center justify-between"><span>Context</span><strong className="font-medium text-[#1f1f1f]">{attachmentCount}</strong></div>
                  </div>
                </section>
              </div>
            )}

            {view === "sessions" && (
              <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">Recent Sessions</span>
                  <span className="rounded-full bg-[#ececec] px-2 py-0.5 text-[11px] font-medium text-[#6d6d6d]">{sessions.length}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                  {sessions.length === 0 ? <div className="rounded-xl border border-dashed border-[#dadada] bg-white px-3 py-4 text-sm text-[#6e6e6e]">No sessions yet.</div> : sessions.map((session) => (
                    <button key={session.id} className={`w-full rounded-xl border px-3 py-3 text-left transition ${session.id === activeSessionId ? "border-[#bfc7d6] bg-[#eef2f8]" : "border-[#e3e3e3] bg-white hover:border-[#d1d1d1]"}`} onClick={() => void openSession(session.id)}>
                      <div className="flex items-start justify-between gap-3"><strong className="line-clamp-1 text-sm font-semibold text-[#1f1f1f]">{session.title}</strong><span className={`mt-1 h-2.5 w-2.5 rounded-full ${statusDotClass(session.status)}`} /></div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6d6d6d]">{session.summary}</p>
                      <p className="mt-2 text-[11px] text-[#8a8a8a]">{new Date(session.updatedAt).toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {view === "catalog" && (
              <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
                <div className="mb-3"><span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">Catalog</span><p className="mt-2 text-sm text-[#5d5d5d]">Skills, agents, MCP connectors, and upstream sources.</p></div>
                <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
                  <DrawerSection title="Skills" count={skillItems.length}>{skillItems.map((item) => <DrawerCatalogItem key={item.id} item={item} onUse={useCatalogItem} />)}</DrawerSection>
                  <DrawerSection title="Agents" count={agentItems.length}>{agentItems.map((item) => <DrawerCatalogItem key={item.id} item={item} onUse={useCatalogItem} />)}</DrawerSection>
                  <DrawerSection title="MCP" count={mcpSources.length}>
                    {mcpSources.length > 0 ? mcpSources.map((source) => (
                      <button key={source.id} className="w-full rounded-xl border border-[#e3e3e3] bg-white px-3 py-3 text-left hover:border-[#d1d1d1]" onClick={() => void syncSource(source.id)}>
                        <div className="flex items-center justify-between gap-3"><strong className="truncate text-sm text-[#1f1f1f]">{source.title}</strong><span className="rounded-full bg-[#efefef] px-2 py-0.5 text-[11px] text-[#666]">{source.enabled ? "enabled" : "paused"}</span></div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6d6d6d]">{source.url}</p>
                      </button>
                    )) : <p className="text-xs leading-5 text-[#6d6d6d]">No MCP connections are listed yet. This panel will show connected tool surfaces over time.</p>}
                  </DrawerSection>
                </div>
              </div>
            )}
          </div>
        </aside>
        <main className="min-h-0 min-w-0 overflow-hidden bg-[#fcfcfc]">
          <div className="flex h-full min-h-0 flex-col">
            <header className="flex items-center justify-between border-b border-[#e7e7e7] bg-[#fbfbfb]/95 px-6 py-4 backdrop-blur-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7a7a7a]">{headerEyebrow(view)}</p>
                </div>
                <h2 className="mt-2 truncate text-[22px] font-semibold tracking-[-0.02em] text-[#181818]">{headerTitle(view, activeSession)}</h2>
                <p className="mt-1 text-sm text-[#666]">{view === "chat" ? "Workspace-bound CLI output streams directly into the transcript." : view === "sessions" ? "Reopen earlier runs and continue from the same workspace context." : "Browse reusable skills, agents, MCP integrations, and sync sources."}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <HeaderChip>{health?.cliVersion ? `gh ${health.cliVersion}` : "CLI checking"}</HeaderChip>
                <HeaderChip>{health?.cliManagedByApp ? "Managed runtime" : "Local runtime"}</HeaderChip>
                <HeaderChip>{health?.authState.status === "authenticated" ? "GitHub connected" : "Login needed"}</HeaderChip>
                <HeaderChip>{busy ? "Running" : "Ready"}</HeaderChip>
                <HeaderChip>{health?.isElevated ? "Admin mode" : "Standard mode"}</HeaderChip>
                <button className="rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa]" onClick={() => void startLogin()} disabled={busy}>{health?.cliInstalled ? "Sign in" : "Install CLI & sign in"}</button>
                {!health?.isElevated && <button className="rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa]" onClick={() => void relaunchElevated()}>Run as admin</button>}
              </div>
            </header>

            {(authNotice || catalogNotice) && <div className="border-b border-[#ececec] bg-[#fffbe9] px-6 py-3 text-sm text-[#6a5a1d]">{authNotice ?? catalogNotice}</div>}

            {view === "chat" && (
              <section className="grid min-h-0 flex-1 grid-rows-[1fr_auto]">
                <div className="min-h-0 overflow-auto px-6 py-6">
                  {currentMessages.length === 0 ? (
                    <div className="mx-auto grid max-w-4xl gap-6">
                      <div className="rounded-2xl border border-[#e5e5e5] bg-white p-8 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">Ready</p>
                        <h3 className="mt-3 text-3xl font-semibold tracking-tight text-[#111]">{workspaceRoot ? "A workspace-native command surface." : "Choose a workspace to begin."}</h3>
                        <p className="mt-3 max-w-2xl text-base leading-7 text-[#5f5f5f]">{workspaceRoot ? "Run Copilot in the selected workspace, inspect files from the flyout, and keep the transcript grounded in raw CLI output." : "Select a project folder first so Command Foundry can show a clean explorer and bind agent runs to that workspace."}</p>
                        {!workspaceRoot && <div className="mt-6"><button className="rounded-xl bg-[#111] px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_rgba(17,17,17,0.16)] transition hover:bg-[#222]" onClick={() => void pickWorkspace()}>Choose workspace</button></div>}
                      </div>
                      {workspaceRoot && <div className="grid gap-3 md:grid-cols-3">{starterPrompts.map((prompt) => <button key={prompt} className="rounded-2xl border border-[#e5e5e5] bg-white p-5 text-left text-sm leading-6 text-[#3d3d3d] shadow-[0_6px_18px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:border-[#cfd5df] hover:bg-[#fafcff]" onClick={() => void sendMessage(prompt)}>{prompt}</button>)}</div>}
                    </div>
                  ) : (
                    <div className="mx-auto flex max-w-4xl flex-col gap-6">
                      {currentMessages.map((message) => (
                        <article key={message.id} className="rounded-2xl border border-[#e7e7e7] bg-white px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                          <div className="mb-3 flex items-center justify-between gap-4 text-xs text-[#7a7a7a]"><strong className="text-sm font-semibold text-[#181818]">{message.role === "user" ? "You" : "Command Foundry"}</strong><span>{new Date(message.createdAt).toLocaleTimeString()}</span></div>
                          {message.role === "assistant" ? <div className="markdown-body text-[15px] leading-7 text-[#2a2a2a]" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} /> : <p className="text-[15px] leading-7 text-[#2a2a2a]">{message.content}</p>}
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-[#e7e7e7] bg-white px-6 py-4">
                  <div className="mx-auto max-w-4xl">
                    {pendingPrompt && (
                      <div className="mb-4 rounded-2xl border border-[#e4d8a9] bg-[#fff9df] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b7a2e]">CLI prompt</p>
                        <p className="mt-2 text-sm leading-6 text-[#5b5021]">{pendingPrompt.message}</p>
                        {pendingPrompt.options && pendingPrompt.options.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{pendingPrompt.options.map((option) => <button key={option.value} className="rounded-lg border border-[#d8c98d] bg-white px-3 py-2 text-sm font-medium text-[#4e441e]" onClick={() => void submitCliPrompt(option.value)}>{option.label}</button>)}</div> : <div className="mt-3 flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-[#d9d9d9] bg-white px-3 py-2 text-sm outline-none ring-0" value={promptInput} onChange={(event) => setPromptInput(event.target.value)} placeholder="Enter the CLI response" /><button className="rounded-xl bg-[#111] px-4 py-2 text-sm font-medium text-white disabled:bg-[#999]" onClick={() => void submitCliPrompt(promptInput)} disabled={!promptInput.trim()}>Submit</button></div>}
                      </div>
                    )}
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">{attachments.map((attachment) => <span key={attachment.id} className="rounded-full bg-[#f0f3f7] px-3 py-1 text-xs font-medium text-[#5b6570]">{attachment.label}</span>)}</div>
                      <div className="flex flex-wrap gap-2">
                        <button className="rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa]" onClick={() => void pickFiles()}>Attach files</button>
                        <button className="rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa]" onClick={() => void pickFolder()}>Attach folder</button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#d9d9d9] bg-[#fbfbfb] p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                      <textarea className="min-h-[110px] w-full resize-y border-0 bg-transparent px-2 py-2 text-[15px] leading-7 text-[#202020] outline-none" value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="Ask Copilot to inspect code, explain output, or move a task forward..." />
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#ececec] px-2 pt-3"><span className="text-xs text-[#7a7a7a]">Assistant responses stream directly from the raw CLI output.</span><button className="rounded-xl bg-[#111] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#222] disabled:bg-[#8c8c8c]" onClick={() => void sendMessage()} disabled={busy}>{busy ? "Running..." : "Send"}</button></div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {view === "sessions" && <section className="min-h-0 flex-1 overflow-auto px-6 py-6"><div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{sessions.map((session) => <article key={session.id} className="rounded-2xl border border-[#e6e6e6] bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-semibold text-[#181818]">{session.title}</h3><p className="mt-1 text-sm leading-6 text-[#666]">{session.summary}</p></div><span className={`mt-1 h-2.5 w-2.5 rounded-full ${statusDotClass(session.status)}`} /></div><p className="mt-4 text-xs text-[#8a8a8a]">{new Date(session.updatedAt).toLocaleString()} • {session.provider}</p><button className="mt-4 rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa]" onClick={() => void openSession(session.id)}>Open session</button></article>)}</div></section>}

            {view === "catalog" && <section className="min-h-0 flex-1 overflow-auto px-6 py-6"><div className="space-y-6"><div className="grid gap-4 xl:grid-cols-3">{catalogGuide.map((section) => <article key={section.title} className="rounded-2xl border border-[#e5e5e5] bg-white p-5"><div className="flex items-center justify-between"><h3 className="text-base font-semibold text-[#181818]">{section.title}</h3><HeaderChip>Guide</HeaderChip></div><p className="mt-3 text-sm leading-6 text-[#666]">{section.blurb}</p><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-[#666]">{section.steps.map((step) => <li key={step}>{step}</li>)}</ol></article>)}</div><CatalogSection title="Skills" subtitle="Prompt shaping, focused workflows, and reusable operating modes." items={skillItems} emptyMessage="No skills are synced yet." onUse={useCatalogItem} onToggle={toggleCatalogItem} /><CatalogSection title="Agents" subtitle="Longer-running task specialists and structured workspace helpers." items={agentItems} emptyMessage="No agents are synced yet." onUse={useCatalogItem} onToggle={toggleCatalogItem} /><CatalogSources sources={catalog.sources} busy={busy} onSync={syncSource} /></div></section>}
          </div>
        </main>
      </div>
    </div>
  );
}
function DrawerSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <section><div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">{title}</span><span className="rounded-full bg-[#ececec] px-2 py-0.5 text-[11px] font-medium text-[#6d6d6d]">{count}</span></div><div className="space-y-2">{children}</div></section>;
}

function DrawerCatalogItem({ item, onUse }: { item: CatalogItem; onUse: (item: CatalogItem) => void }) {
  return <button className="w-full rounded-xl border border-[#e3e3e3] bg-white px-3 py-3 text-left hover:border-[#d1d1d1]" onClick={() => onUse(item)}><div className="flex items-center justify-between gap-3"><strong className="truncate text-sm text-[#1f1f1f]">{item.title}</strong><span className="rounded-full bg-[#efefef] px-2 py-0.5 text-[11px] text-[#666]">{item.status}</span></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6d6d6d]">{item.description}</p></button>;
}

function CatalogSection({ title, subtitle, items, emptyMessage, onUse, onToggle }: { title: string; subtitle: string; items: CatalogItem[]; emptyMessage: string; onUse: (item: CatalogItem) => void; onToggle: (itemId: string, enabled: boolean) => Promise<void> }) {
  return <section className="space-y-4"><div className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">{title}</p><h3 className="mt-2 text-lg font-semibold text-[#181818]">{subtitle}</h3></div><HeaderChip>{items.length}</HeaderChip></div><div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{items.length > 0 ? items.map((item) => <article key={item.id} className="rounded-2xl border border-[#e5e5e5] bg-white p-5"><div className="flex items-center justify-between gap-3"><h4 className="text-base font-semibold text-[#181818]">{item.title}</h4><HeaderChip>{item.status}</HeaderChip></div><p className="mt-3 text-sm leading-6 text-[#666]">{item.description}</p><div className="mt-4 flex flex-wrap gap-2 text-xs text-[#7a7a7a]"><span className="rounded-full bg-[#f1f3f5] px-2.5 py-1">Kind: {item.kind}</span><span className="rounded-full bg-[#f1f3f5] px-2.5 py-1">Version: v{item.version}</span><span className="rounded-full bg-[#f1f3f5] px-2.5 py-1">Source: {item.sourceId}</span></div><p className="mt-4 text-sm leading-6 text-[#666]">{item.kind === "skill" ? "Use this when you want a repeatable prompt pattern or focused workflow in the current workspace." : "Use this when you want a broader specialist to drive a larger task across the workspace."}</p><div className="mt-5 flex flex-wrap gap-2"><button className="rounded-lg bg-[#111] px-3 py-2 text-sm font-medium text-white hover:bg-[#222]" onClick={() => onUse(item)}>Use in chat</button><button className="rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa]" onClick={() => void onToggle(item.id, !item.enabled)}>{item.enabled ? "Disable" : "Enable"}</button></div></article>) : <article className="rounded-2xl border border-dashed border-[#d9d9d9] bg-white p-5 text-sm text-[#666]">{emptyMessage}</article>}</div></section>;
}

function CatalogSources({ sources, busy, onSync }: { sources: SyncSource[]; busy: boolean; onSync: (sourceId: string) => Promise<void> }) {
  return <section className="space-y-4"><div className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7c7c7c]">Sources</p><h3 className="mt-2 text-lg font-semibold text-[#181818]">Upstream repos and catalogs</h3></div><HeaderChip>{sources.length}</HeaderChip></div><div className="grid gap-4 lg:grid-cols-2">{sources.map((source) => <article key={source.id} className="rounded-2xl border border-[#e5e5e5] bg-white p-5"><div className="flex items-center justify-between gap-3"><h4 className="text-base font-semibold text-[#181818]">{source.title}</h4><HeaderChip>{source.enabled ? "enabled" : "paused"}</HeaderChip></div><p className="mt-3 text-sm leading-6 text-[#666]">{source.url}</p><p className="mt-2 text-xs text-[#8a8a8a]">Last sync: {source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : "never"}</p><button className="mt-4 rounded-lg border border-[#d8d8d8] bg-white px-3 py-2 text-sm font-medium text-[#2a2a2a] hover:bg-[#fafafa] disabled:opacity-50" onClick={() => void onSync(source.id)} disabled={busy}>Sync now</button></article>)}</div></section>;
}

function HeaderChip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-[#f0f2f5] px-3 py-1 text-xs font-medium text-[#5d6773]">{children}</span>;
}

function FileTree({ nodes, depth }: { nodes: FileTreeNode[]; depth: number }) {
  return <div className="space-y-0.5">{nodes.map((node) => <div key={node.id}><div className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-[#4f4f4f] hover:bg-[#eceff4]" style={{ paddingLeft: `${depth * 14 + 8}px` }}><span className={`h-2.5 w-2.5 rounded-[3px] ${node.type === "directory" ? "bg-[#d6b15f]" : "bg-[#9ca3af]"}`} /><span className="truncate">{node.name}</span></div>{node.children && node.children.length > 0 ? <FileTree nodes={node.children} depth={depth + 1} /> : null}</div>)}</div>;
}

function drawerLabel(view: View): string { return view === "chat" ? "Workspace" : view === "sessions" ? "Recent" : "Catalog"; }
function drawerTitle(view: View): string { return view === "chat" ? "Workspace Explorer" : view === "sessions" ? "Session History" : "Catalog Browser"; }
function drawerSubtitle(view: View): string { return view === "chat" ? "Explorer, context, and live command output" : view === "sessions" ? "Saved runs from this machine" : "Skills, agents, MCP, and sync sources"; }
function headerEyebrow(view: View): string { return view === "chat" ? "Workspace" : view === "sessions" ? "Sessions" : "Catalog"; }
function headerTitle(view: View, activeSession?: SessionRecord): string { return view === "chat" ? activeSession?.title ?? "New chat" : view === "sessions" ? "Session library" : "Skills, agents, and integrations"; }
function statusDotClass(status: SessionRecord["status"]) { return status === "running" ? "bg-amber-500" : status === "complete" ? "bg-emerald-500" : status === "error" ? "bg-rose-500" : "bg-slate-300"; }
function IconShell({ active, children }: { active?: boolean; children: ReactNode }) { return <span className={`inline-flex h-[18px] w-[18px] items-center justify-center ${active ? "text-white" : ""}`}>{children}</span>; }
function ChatIcon({ active }: { active?: boolean }) { return <IconShell active={active}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-[18px] w-[18px]"><path d="M4 5.75A2.75 2.75 0 0 1 6.75 3h6.5A2.75 2.75 0 0 1 16 5.75v4.1a2.75 2.75 0 0 1-2.75 2.75H9l-3.75 3V12.6h1.5A2.75 2.75 0 0 1 4 9.85z" /></svg></IconShell>; }
function HistoryIcon({ active }: { active?: boolean }) { return <IconShell active={active}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-[18px] w-[18px]"><path d="M3.5 10a6.5 6.5 0 1 0 2.1-4.8" /><path d="M3.5 4v3.5H7" /><path d="M10 6.2v4.1l2.7 1.6" /></svg></IconShell>; }
function LibraryIcon({ active }: { active?: boolean }) { return <IconShell active={active}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-[18px] w-[18px]"><path d="M4.5 4.5h7.5v11H4.5z" /><path d="M7.5 4.5v11" /><path d="M13 6h2.5v9H13" /></svg></IconShell>; }
function PanelToggleIcon({ collapsed }: { collapsed: boolean }) { return <IconShell><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-[18px] w-[18px]"><rect x="3.5" y="3.5" width="13" height="13" rx="2" /><path d="M8 3.5v13" />{collapsed ? <path d="m11 10 2.4-2.4M11 10l2.4 2.4" /> : <path d="m13.4 10-2.4-2.4M13.4 10l-2.4 2.4" />}</svg></IconShell>; }

function renderMarkdown(content: string): string {
  const escaped = escapeHtml(content);
  const fenced = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => `<pre><code>${code.trim()}</code></pre>`);
  const inline = fenced.replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const blocks = inline.split(/\n{2,}/).map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("<h1>") || trimmed.startsWith("<h2>") || trimmed.startsWith("<h3>") || trimmed.startsWith("<pre>")) return trimmed;
    if (/^- /m.test(trimmed)) {
      const items = trimmed.split("\n").filter((line) => line.startsWith("- ")).map((line) => `<li>${line.slice(2)}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${trimmed.replace(/\n/g, "<br />")}</p>`;
  }).join("");
  return blocks || "<p></p>";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}


