/* ═══════════════════════════════════════════════════════════════
   FIREBASE CONFIG — SupportBase
   ═══════════════════════════════════════════════════════════════

   👉 PASSO A PASSO (faça isso ANTES de usar o site):

   1. Acesse https://console.firebase.google.com e crie um projeto
      novo (gratuito, plano "Spark"). Pode dar o nome que quiser,
      ex: "supportbase".

   2. No menu lateral, vá em "Build" > "Authentication".
      - Clique em "Get started".
      - Na aba "Sign-in method", habilite o provedor "E-mail/senha".

   3. Ainda em Authentication, vá na aba "Users" > "Add user".
      - Cadastre um e-mail (não precisa ser um e-mail real que você
        usa, pode ser algo como "marcos@suporte.local") e uma senha
        (pode usar a mesma "mbeocmfdm83" ou outra de sua escolha).
      - Esse será o login do site.

   4. No menu lateral, vá em "Build" > "Firestore Database".
      - Clique em "Create database".
      - Escolha "Start in production mode".
      - Escolha a região mais próxima (ex: southamerica-east1 para
        servidores no Brasil).

   5. Na aba "Rules" do Firestore, APAGUE o conteúdo padrão e cole
      as regras abaixo. Elas garantem que CADA usuário só acessa
      os PRÓPRIOS dados (mesmo que alguém crie outra conta, não
      conseguirá ler/escrever os seus dados):

      ─────────────────────────────────────────────────────────
      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /supportbase/{userId} {
            allow read, write: if request.auth != null
                                && request.auth.uid == userId;
          }
        }
      }
      ─────────────────────────────────────────────────────────

      Clique em "Publish" para salvar as regras.

   6. Volte para a página inicial do projeto (ícone de engrenagem >
      "Configurações do projeto" > aba "Geral").
      Role até "Seus aplicativos" > clique no ícone "</>"  (Web)
      para registrar um app. Dê um nome (ex: "supportbase-web") e
      NÃO marque "Firebase Hosting".

   7. O Firebase vai mostrar um objeto "firebaseConfig" parecido
      com o exemplo abaixo. COPIE os valores reais e substitua
      no objeto FIREBASE_CONFIG mais abaixo neste arquivo.

   ⚠️ IMPORTANTE SOBRE SEGURANÇA:
   Esses valores (apiKey, authDomain, etc.) são públicos por design
   — eles identificam o PROJETO, não dão acesso a nada por si só.
   A segurança real vem das regras do Firestore (passo 5) + do
   login (Authentication). Por isso é seguro deixar este arquivo
   no repositório do GitHub, mesmo sendo público.
   ═══════════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCGDDh7NgbFTD4ON-UU-dufJI0_FwV2MP8",
  authDomain:        "site-busca-eead8.firebaseapp.com",
  projectId:         "site-busca-eead8",
  storageBucket:     "site-busca-eead8.firebasestorage.app",
  messagingSenderId: "145605133209",
  appId:             "1:145605133209:web:eea8746318123ee3828908"
};
