// Validação básica dos arquivos de dados.
// Por enquanto confere só o mínimo do CLAUDE.md: cada arquivo é uma lista JSON
// e todo registro tem fonte_url e verificado_em (AAAA-MM-DD).
// A validação completa por schema entra quando os schemas forem escritos.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ARQUIVOS = ['programas', 'cartoes', 'lojas', 'ofertas'];
const PASTA_DADOS = new URL('../dados/', import.meta.url);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function validarDados(pasta = PASTA_DADOS) {
  const erros = [];
  for (const nome of ARQUIVOS) {
    const arquivo = `${nome}.json`;
    let registros;
    try {
      registros = JSON.parse(await readFile(new URL(arquivo, pasta), 'utf8'));
    } catch (erro) {
      erros.push(`${arquivo}: não foi possível ler o JSON (${erro.message})`);
      continue;
    }
    if (!Array.isArray(registros)) {
      erros.push(`${arquivo}: deve conter uma lista ([])`);
      continue;
    }
    registros.forEach((registro, i) => {
      if (typeof registro?.fonte_url !== 'string' || !registro.fonte_url.startsWith('https://')) {
        erros.push(`${arquivo}[${i}]: fonte_url ausente ou sem https://`);
      }
      if (typeof registro?.verificado_em !== 'string' || !DATA.test(registro.verificado_em)) {
        erros.push(`${arquivo}[${i}]: verificado_em ausente ou fora do formato AAAA-MM-DD`);
      }
    });
  }
  return erros;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const erros = await validarDados();
  if (erros.length > 0) {
    console.error(`Dados inválidos (${erros.length} problema(s)):`);
    for (const erro of erros) console.error(`- ${erro}`);
    process.exit(1);
  }
  console.log('Dados válidos.');
}
