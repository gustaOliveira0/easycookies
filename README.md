# Gerador de Presell de Cookies

Plataforma local que monta a presell: o **print do site borrado ao fundo** e, na frente,
o **modal de consentimento de cookies**. Os dois botões (aceitar e recusar) apontam para
o **link de afiliado**.

## Como abrir (passo a passo, sem precisar saber programar)

**1. Baixe o projeto.** Nesta página do GitHub, clique no botão verde **Code** e depois em
**Download ZIP**. Descompacte o arquivo numa pasta qualquer (ex.: Documentos).

**2. Tenha o Google Chrome instalado** (é ele que tira os prints dos sites). No Windows,
se não tiver Chrome, o Edge serve.

**3. Dê dois cliques no iniciador do seu sistema**, dentro da pasta descompactada:

| Sistema | Arquivo | |
|---|---|---|
| Windows | `INICIAR-WINDOWS.bat` | Se aparecer "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**. |
| Mac | `INICIAR-MAC.command` | Na primeira vez, clique com o **botão direito → Abrir → Abrir** (o Mac bloqueia o duplo clique de arquivos baixados). |
| Linux | `iniciar.sh` | Ou, no terminal: `./iniciar.sh` |

O painel abre sozinho no navegador, em <http://localhost:7001>.

- **Precisa do Node.js.** Se não estiver instalado, o iniciador do Windows tenta instalar
  sozinho; se não conseguir (ou no Mac), ele abre o site <https://nodejs.org/pt>. Baixe a
  versão **LTS**, instale clicando em "Próximo" até o fim e dê dois cliques no iniciador de novo.
  Isso só é necessário na primeira vez.
- **Deixe a janela preta aberta** enquanto usa o painel. Para desligar, é só fechá-la.
- As presells geradas ficam na pasta `saidas`, dentro da pasta do projeto.

Para quem usa terminal: `npm start` também sobe o painel. Para trocar a porta:
`PORT=8080 ./iniciar.sh`; para não abrir o navegador sozinho: `SEM_NAVEGADOR=1`.

## Como usar

1. **Link de afiliado e prints** — cole o link de afiliado: ele é o destino dos dois botões
   do popup e também o site dos prints. Ao colar, o servidor abre a página no Chrome em
   modo headless (nenhuma janela aparece) e tira os três prints, nos tamanhos de desktop,
   tablet e celular, além de buscar o favicon; *Puxar prints* refaz a captura. Também dá
   para arrastar os arquivos na mão. Tudo é convertido para `.webp` no navegador (imagens
   largas demais são reduzidas), e cada aparelho recebe a sua por `<picture>` com media
   queries. Escolha país e idioma: os textos do popup, a Política de Privacidade e os
   Termos de Uso saem prontos no idioma escolhido (42 idiomas). Ajuste o desfoque e o
   escurecimento do fundo nos sliders.
2. **Aparência** — cores, bordas e cor do texto de cada botão. Marque *Editar os textos do
   popup manualmente* se quiser escrever o texto no lugar do padrão do idioma.
3. **Políticas, SEO e rastreamento** — ligue/desligue os links de política e termos e cole
   os pixels. O SEO sai pronto: preencha nome do produto, preço e moeda, garantia,
   desconto máximo (em % e/ou em valor) e a chave de frete grátis, e clique em *Gerar SEO*.
   Isso escreve quatro coisas no idioma do país escolhido no passo 1: o bloco do modal
   "Learn More" (sempre com mais de 4000 caracteres: sobre, como pedir, vantagens da loja
   oficial, perguntas frequentes, dicas e conclusão), o título da página, a meta descrição
   e o esquema markup, nos campos logo abaixo. Tudo continua editável, e nada impede colar
   conteúdo próprio no lugar.

   O título sai no formato de oferta, com o nome do país por extenso no idioma da página
   e os dados na ordem de apelo:

   ```
   FuelSync Pro Official United Kingdom: Save Up to 50% – Special Price £29.99 + 30-Day Guarantee
   KatuChef Oficial Brasil: Economize até 40% – Preço especial R$ 197,00 + 90 dias de garantia
   ```

   Cada pedaço só entra se o dado foi preenchido e se ainda couber em 110 caracteres. O
   desconto em valor só vai ao título quando não há o percentual. A meta descrição traz os
   mesmos dados em lista, com o país por extenso, e para em 155.

   O esquema markup sai como JSON-LD do tipo `Product`, com `Offer`, `WarrantyPromise`,
   `OfferShippingDetails` e o vendedor. Cada bloco só aparece com o dado correspondente:
   sem preço não há oferta, sem garantia não há promessa de garantia, e o frete só entra
   quando é grátis. Não há nota nem contagem de avaliações, que seriam dados inventados.

   O preço e o desconto em valor saem formatados na moeda escolhida (`197` com o Brasil
   vira `R$ 197,00`). Sem a chave de frete grátis, o texto fala em envio rápido pela
   transportadora local; com ela, fala em frete grátis.
4. **Gerar** — a página aparece na lista à direita, com link para abrir e para baixar o `.zip`.
   O formulário e as imagens ficam guardados neste navegador, então a presell seguinte
   começa preenchida: para outro país, basta trocar o país e gerar de novo. *Limpar tudo*,
   embaixo do botão, apaga o que está guardado.

A pré-visualização à direita é a página real, renderizada em desktop / tablet / celular,
e atualiza sozinha a cada mudança.

## O que sai

Cada presell vira uma pasta em `saidas/<slug>/`:

```
index.html      página pronta, tudo inline (nenhum CSS/JS externo)
w.webp          imagem desktop     (>= 1025px)
t.webp          imagem tablet      (768–1024px)
m.webp          imagem celular     (<= 767px)
favicon.<ext>   se enviado
config.json     configuração usada (não entra no .zip)
```

O `.zip` traz esses arquivos prontos para subir na raiz do domínio. Se marcar
*colocar dentro da pasta do país* (e do idioma), o zip vira `us/en/index.html`, etc.

A página é feita para o PageSpeed: CSS e JS inline, imagens em `.webp` com `preload` da
imagem de cada tela (o LCP), largura e altura declaradas, favicon sempre presente (sem 404
no console), contraste e área de toque dos links dentro do mínimo de acessibilidade. As
imagens levam `?v=<hash>` no endereço, então quem hospeda pode deixá-las em cache por um
ano; o próprio servidor já faz isso em `/p/` e comprime o HTML com gzip.

## Prints automáticos

O gerador usa o Google Chrome já instalado (ou o Microsoft Edge, se não houver Chrome), chamado com `--headless=new --screenshot`.
Nenhuma dependência entra no projeto e nenhuma janela abre. Se o Chrome estiver em outro
caminho, aponte a variável `CHROME` para o executável:

```bash
CHROME=/caminho/do/chrome ./iniciar.sh
```

As telas são 1440×900 no desktop, 820×1180 no tablet e 390×844 no celular, estas duas
últimas com user agent de iPad e iPhone, para o site servir o layout certo. O endereço é
conferido antes: domínio que não resolve ou resposta 400 pra cima viram erro, em vez de um
print da página de erro do navegador.

## Estrutura do projeto

```
INICIAR-WINDOWS.bat  iniciador de dois cliques (Windows)
INICIAR-MAC.command  iniciador de dois cliques (Mac)
iniciar.sh           iniciador (Linux / terminal)
server.js            servidor HTTP + gerador da página + empacotador .zip (Node puro, sem dependências)
public/index.html    painel
data/idiomas.json    textos do popup, política e termos em 42 idiomas
data/seo.json        modelos do bloco de SEO nos mesmos 42 idiomas
data/paises.json     53 países e os idiomas de cada um
saidas/              presells geradas
```

## Observação

O idioma **russo (ru)** aparece na lista de Bielorrússia e Rússia, mas não tem tradução
pronta (a base original também não tinha). Se for escolhido, o painel avisa e a página sai
em inglês.
