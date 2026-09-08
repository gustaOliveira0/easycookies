# Gerador de Presell de Cookies

Plataforma local que monta a presell: o **print do site borrado ao fundo** e, na frente,
o **modal de consentimento de cookies**. Os dois botões (aceitar e recusar) apontam para
o **link de afiliado**.

## Como rodar

```bash
cd ~/presell-cookies
./iniciar.sh          # ou: npm start
```

Abra <http://localhost:7001>. Para trocar a porta: `PORT=8080 ./iniciar.sh`.

## Como usar

1. **Destino e identificação** — cole o link de afiliado, o título e a meta descrição da página.
   Escolha país e idioma: os textos do popup, a Política de Privacidade e os Termos de Uso
   saem prontos no idioma escolhido (42 idiomas).
2. **Imagens** — arraste os 3 prints do site (desktop, tablet e celular). São servidos por
   `<picture>` com media queries, então cada aparelho recebe a imagem certa.
   Ajuste o desfoque e o escurecimento do fundo nos sliders. Favicon é opcional.
3. **Aparência** — cores, bordas e cor do texto de cada botão. Marque *Editar os textos do
   popup manualmente* se quiser escrever o texto no lugar do padrão do idioma.
4. **Políticas, SEO e rastreamento** — ligue/desligue os links de política e termos, cole o
   HTML de SEO (vai para o modal "Learn More"), o esquema markup e pixels.
5. **Gerar** — a página aparece na lista à direita, com link para abrir e para baixar o `.zip`.

A pré-visualização à direita é a página real, renderizada em desktop / tablet / celular,
e atualiza sozinha a cada mudança.

## O que sai

Cada presell vira uma pasta em `saidas/<slug>/`:

```
index.html      página pronta, tudo inline (nenhum CSS/JS externo)
w.<ext>         imagem desktop     (>= 1025px)
t.<ext>         imagem tablet      (768–1024px)
m.<ext>         imagem celular     (<= 767px)
favicon.<ext>   se enviado
config.json     configuração usada (não entra no .zip)
```

O `.zip` traz esses arquivos prontos para subir na raiz do domínio. Se marcar
*colocar dentro da pasta do país* (e do idioma), o zip vira `us/en/index.html`, etc.

## Estrutura do projeto

```
server.js            servidor HTTP + gerador da página + empacotador .zip (Node puro, sem dependências)
public/index.html    painel
data/idiomas.json    textos do popup, política e termos em 42 idiomas
data/paises.json     53 países e os idiomas de cada um
saidas/              presells geradas
```

## Observação

O idioma **russo (ru)** aparece na lista de Bielorrússia e Rússia, mas não tem tradução
pronta (a base original também não tinha). Se for escolhido, o painel avisa e a página sai
em inglês.
