// Cliente mínimo da API do GitHub: criar issue e comentar. Sem dependência.
//
// O token é um fine-grained token com acesso SÓ ao repositório privado de
// reportes e SÓ à permissão "Issues: Read and write". Ele fica guardado como
// segredo na Cloudflare (GITHUB_TOKEN) e nunca entra no repositório.

const API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export class ErroDoGithub extends Error {
  constructor(status) {
    super(`GitHub respondeu ${status}`);
    this.status = status;
  }
}

/**
 * @param {object} opcoes
 * @param {string} opcoes.token
 * @param {string} opcoes.repo   "dono/nome"
 * @param {typeof fetch} [opcoes.buscar]
 */
export function clienteGithub({ token, repo, buscar = fetch }) {
  if (!token || !REPO.test(repo ?? '')) return null;
  async function chamar(caminho, corpo) {
    const resposta = await buscar(`${API}/repos/${repo}${caminho}`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'reportes-do-site',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(corpo),
    });
    if (!resposta.ok) throw new ErroDoGithub(resposta.status);
    return resposta.json();
  }
  return {
    criarIssue: ({ title, body, labels }) => chamar('/issues', { title, body, labels }),
    comentar: (numero, body) => chamar(`/issues/${Number(numero)}/comments`, { body }),
  };
}
