import { useState, useEffect, useRef } from "react";
import "./App.css";
import { supabase } from "./supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const generos = ["masculino", "feminino", "compartilhável"];
const categorias = ["nacional", "árabe", "designer", "nicho"];

function traduzirGenero(genero) {
  if (genero === "men") return "masculino";
  if (genero === "women") return "feminino";
  if (genero === "unisex") return "unissex";
  return genero;
}

function PerfumeCard({ perfume, index }) {
  const notas = perfume.notas
    .split("|")
    .map((n) => n.trim())
    .filter(Boolean);
  const accords = perfume.accords
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 3);

  return (
    <div
      className="perfume-card"
      style={{ animationDelay: `${index * 0.08}s` }}
    >
      <div className="card-top">
        <span className="card-num">0{index + 1}</span>
        <span className="card-genero">{traduzirGenero(perfume.genero)}</span>
      </div>
      <h3 className="card-nome">{perfume.nome.replace(/-/g, " ")}</h3>
      <p className="card-marca">{perfume.marca.replace(/-/g, " ")}</p>
      <div className="card-sep" />
      <div className="card-notas">
        {notas.map((n, i) => (
          <span key={i} className="nota">
            {n}
          </span>
        ))}
      </div>
      <div className="card-accords">
        {accords.map((a, i) => (
          <span key={i} className="accord">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

function ModalLogin({ onAnonimo }) {
  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h1 className="login-brand">Olfatto</h1>
        <h2>Bem-vindo!</h2>
        <p>
          Entre com sua conta Google para salvar seu histórico de conversas e
          receber recomendações personalizadas!
        </p>
        <button className="google-btn" onClick={handleGoogle}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path
              fill="#4285F4"
              d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"
            />
            <path
              fill="#34A853"
              d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"
            />
            <path
              fill="#FBBC05"
              d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"
            />
            <path
              fill="#EA4335"
              d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"
            />
          </svg>
          Entrar com Google
        </button>
        <button className="anonimo-btn" onClick={onAnonimo}>
          Continuar anonimamente
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [anonimo, setAnonimo] = useState(false);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [pendingBusca, setPendingBusca] = useState(false);
  const [genero, setGenero] = useState("");
  const [categoria, setCategoria] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [mensagens, setMensagens] = useState([]);
  const [erro, setErro] = useState("");
  const [sessoes, setSessoes] = useState([]);
  const [sessaoAtiva, setSessaoAtiva] = useState(null);
  const [sidebarAberta, setSidebarAberta] = useState(false);
  const [conversando, setConversando] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        carregarSessoes(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) carregarSessoes(u.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens, loading]);

  async function carregarSessoes(userId) {
    const { data } = await supabase
      .from("sessoes")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5);

    if (data) setSessoes(data);
  }

  async function carregarMensagensSessao(sessaoId) {
    const { data } = await supabase
      .from("historico")
      .select("*")
      .eq("sessao_id", sessaoId)
      .order("created_at", { ascending: true });

    if (data) {
      const msgs = [];
      data.forEach((h) => {
        msgs.push({ tipo: "usuario", texto: h.query });
        msgs.push({ tipo: "ia", recomendacao: h.recomendacao, dados: h.dados });
      });
      setMensagens(msgs);
    }
  }

  async function criarSessao(userId, titulo) {
    const { count } = await supabase
      .from("sessoes")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    const numero = (count || 0) + 1;

    const { data } = await supabase
      .from("sessoes")
      .insert({ user_id: userId, titulo: `histórico ${numero}` })
      .select()
      .single();
    return data;
  }

  async function atualizarSessao(sessaoId) {
    await supabase
      .from("sessoes")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessaoId);
  }

  async function apagarSessao(sessaoId, index) {
    await supabase.from("historico").delete().eq("sessao_id", sessaoId);
    await supabase.from("sessoes").delete().eq("id", sessaoId);
    setSessoes((prev) => prev.filter((_, i) => i !== index));
    if (sessaoAtiva === sessaoId) {
      setSessaoAtiva(null);
      setMensagens([]);
      setConversando(false);
    }
  }

  function handleBuscarClick() {
    if (!query.trim()) return;
    if (!user && !anonimo) {
      setMostrarModal(true);
      setPendingBusca(true);
      return;
    }
    buscar();
  }

  function handleAnonimo() {
    setAnonimo(true);
    setMostrarModal(false);
    if (pendingBusca) {
      setPendingBusca(false);
      setTimeout(() => buscar(), 100);
    }
  }

  async function buscar() {
    if (!query.trim()) return;
    setLoading(true);
    setErro("");
    setConversando(true);

    const queryOriginal = query;
    const queryCompleta = [
      genero && `Gênero: ${genero}.`,
      categoria && `Categoria: ${categoria}.`,
      query,
    ]
      .filter(Boolean)
      .join(" ");

    setMensagens((prev) => [
      ...prev,
      { tipo: "usuario", texto: queryOriginal },
    ]);
    setQuery("");

    try {
      let sessaoId = sessaoAtiva;
      if (!sessaoId && user) {
        const novaSessao = await criarSessao(
          user.id,
          queryOriginal.slice(0, 40),
        );
        sessaoId = novaSessao?.id;
        setSessaoAtiva(sessaoId);
        await carregarSessoes(user.id);
      }

      const res = await fetch(SUPABASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          userQuery: queryCompleta,
          queryOriginal: queryOriginal,
          genero,
          categoria,
        }),
      });

      const data = await res.json();
      if (!data.sucesso) {
        setErro(data.error || "Erro ao buscar perfumes. Tente novamente.");
        setLoading(false);
        return;
      }

      setMensagens((prev) => [
        ...prev,
        {
          tipo: "ia",
          recomendacao: data.recomendacao,
          dados: data.dados,
        },
      ]);

      if (user && sessaoId) {
        await supabase.from("historico").insert({
          user_id: user.id,
          sessao_id: sessaoId,
          query: queryOriginal,
          query_completa: queryCompleta,
          recomendacao: data.recomendacao,
          dados: data.dados,
        });
        await atualizarSessao(sessaoId);
        await carregarSessoes(user.id);
      }
    } catch {
      setErro("Erro ao buscar perfumes. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSair() {
    await supabase.auth.signOut();
    setUser(null);
    setAnonimo(false);
    setSessoes([]);
    setMensagens([]);
    setSessaoAtiva(null);
    setConversando(false);
  }

  function novaConversa() {
    setSessaoAtiva(null);
    setMensagens([]);
    setConversando(false);
    setQuery("");
    setSidebarAberta(false);
  }

  const nomeExibido =
    user?.user_metadata?.name?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "";

  return (
    <div
      className="app"
      onClick={(e) => {
        if (
          sidebarAberta &&
          !e.target.closest(".sidebar") &&
          !e.target.closest(".nome-pill")
        ) {
          setSidebarAberta(false);
        }
      }}
    >
      {mostrarModal && <ModalLogin onAnonimo={handleAnonimo} />}

      {user && (
        <aside className={`sidebar ${sidebarAberta ? "aberta" : ""}`}>
          <div className="sidebar-nome">{nomeExibido}</div>
          <button className="nova-conversa-btn" onClick={novaConversa}>
            + nova conversa
          </button>
          <nav className="sidebar-nav">
            {sessoes.map((sessao, i) => (
              <div key={sessao.id} className="hist-item">
                <button
                  className={`hist-btn ${sessaoAtiva === sessao.id ? "ativo" : ""}`}
                  onClick={() => {
                    if (sessaoAtiva === sessao.id) {
                      setSessaoAtiva(null);
                      setMensagens([]);
                      setConversando(false);
                    } else {
                      setSessaoAtiva(sessao.id);
                      setConversando(true);
                      carregarMensagensSessao(sessao.id);
                    }
                    setSidebarAberta(false);
                  }}
                >
                  {sessao.titulo?.slice(0, 18) || `histórico ${i + 1}`}
                </button>
                <button
                  className="hist-del"
                  onClick={() => apagarSessao(sessao.id, i)}
                >
                  ✕
                </button>
              </div>
            ))}
          </nav>
          <button className="sair-btn" onClick={handleSair}>
            sair
          </button>
        </aside>
      )}

      <div className="main">
        <header className="header">
          {user ? (
            <button
              className="nome-pill"
              onClick={() => setSidebarAberta(!sidebarAberta)}
            >
              {nomeExibido}
            </button>
          ) : (
            <button className="nome-pill" onClick={() => setMostrarModal(true)}>
              log-in
            </button>
          )}
          <div className="header-center">
            <h1>Olfatto</h1>
            <p>Descubra novas fragrâncias e desfrute de novas experiências.</p>
          </div>
          <div style={{ minWidth: "80px" }} />
        </header>

        <div className="conteudo">
          {conversando ? (
            <div className="resultado-area">
              {mensagens.map((msg, i) =>
                msg.tipo === "usuario" ? (
                  <div key={i} className="chat-row chat-user">
                    <div className="chat-bubble chat-bubble-user">
                      <p>{msg.texto}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="ia-bloco">
                    {msg.recomendacao && (
                      <div className="chat-row chat-ia">
                        <div className="chat-avatar">✦</div>
                        <div className="chat-bubble chat-bubble-ia">
                          <span className="resposta-label">Resposta da IA</span>
                          <p>{msg.recomendacao}</p>
                        </div>
                      </div>
                    )}
                    {msg.dados && msg.dados.length > 0 && (
                      <div className="cards-wrapper">
                        <div className="cards-grid">
                          {msg.dados.map((p, j) => (
                            <PerfumeCard
                              key={`${i}-${j}`}
                              perfume={p}
                              index={j}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ),
              )}

              {loading && (
                <div className="chat-row chat-ia">
                  <div className="chat-avatar">✦</div>
                  <div className="chat-bubble chat-bubble-ia">
                    <span className="loading-dots">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  </div>
                </div>
              )}

              {erro && <p className="erro">{erro}</p>}
              <div ref={bottomRef} />

              <div className="nova-busca">
                <textarea
                  className="query-input"
                  placeholder="Responder a Olfatto..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    (e.preventDefault(), handleBuscarClick())
                  }
                />
                <div className="busca-row">
                  <button
                    className="buscar-btn"
                    onClick={handleBuscarClick}
                    disabled={loading}
                  >
                    {loading ? <span className="spinner" /> : "buscar"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="busca-area">
              <h2>Qual é o seu perfume ideal?</h2>
              <p className="busca-desc">
                Nossa IA te ajudará a encontrar novos horizontes no mundo da
                perfumaria! Descreva ocasiões de uso, suas preferências ou tipo
                de fragrância que você procura.
              </p>

              <div className="filtros-box">
                <p className="filtros-hint">
                  Selecione o gênero e a categoria do perfume para a
                  recomendação ser assertiva!
                </p>
                <div className="filtros-row">
                  <span>Gênero:</span>
                  {generos.map((g) => (
                    <button
                      key={g}
                      className={`filtro-btn ${genero === g ? "ativo" : ""}`}
                      onClick={() => setGenero(genero === g ? "" : g)}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div className="filtros-row">
                  <span>Categoria:</span>
                  {categorias.map((c) => (
                    <button
                      key={c}
                      className={`filtro-btn ${categoria === c ? "ativo" : ""}`}
                      onClick={() => setCategoria(categoria === c ? "" : c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                className="query-input"
                placeholder="Descreva o tipo de perfume que você procura."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  (e.preventDefault(), handleBuscarClick())
                }
              />

              {erro && <p className="erro">{erro}</p>}

              <div className="busca-row">
                <button
                  className="buscar-btn"
                  onClick={handleBuscarClick}
                  disabled={loading}
                >
                  {loading ? <span className="spinner" /> : "buscar"}
                </button>
              </div>

              <div className="features">
                <div className="feature">
                  <strong>Resultados Personalizados</strong>
                  <p>Sugestões únicas baseadas no seu gosto e estilo.</p>
                </div>
                <div className="feature">
                  <strong>Base de Dados Ampla</strong>
                  <p>Sistema treinado com milhares de fragrâncias.</p>
                </div>
                <div className="feature">
                  <strong>Economia de Tempo</strong>
                  <p>Sugestões feitas em segundos.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
