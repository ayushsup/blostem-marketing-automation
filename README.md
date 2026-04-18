Here is a complete, highly detailed, and professional `README.md` file for the Blostem AI Engine. It is formatted specifically to impress hackathon judges, recruiters, or open-source contributors by highlighting the enterprise-grade architecture we just built.

Copy this entire block and paste it into a `README.md` file in the root of your project:

````markdown
# ⚡ Blostem AI Engine

**Enterprise AI Signal Intelligence & Automated Outreach Platform**

[![Live Application](https://img.shields.io/badge/Live_Demo-Test_Blostem_Here-00D4AA?style=for-the-badge)](YOUR_VERCEL_URL_HERE)

Blostem is an enterprise-grade marketing automation platform designed for high-velocity sales teams. It ingests unstructured web intelligence, uses AI to detect buying signals and pain points, and automatically generates highly personalized, compliance-safe, 4-touch outreach sequences.

---

## 🚀 Core Features

### 1. AI Signal Detection
Stop manually researching leads. Paste a raw news article, LinkedIn post, or funding announcement into the "Add Lead" engine. Blostem’s AI instantly extracts the core **Intent Signal**, identifies the underlying **Pain Point**, calculates a pipeline **Score**, and determines the **Best Time to Send**.

### 2. Live Streaming AI Generation
Powered by the **Vercel AI SDK**, Blostem streams the generation of complex, 4-touch sequences (Email 1, Email 2, LinkedIn, and Call Script) letter-by-letter in real-time. It completely adapts its persona, tone, and technical depth based on the lead's specific role (e.g., pitching "audit trails" to a CCO vs. "speed to market" to a Product Manager).

### 3. Auto-Pilot Batch Processing
Sales reps don't have time to click "Generate" 100 times. The Auto-Pilot engine autonomously sweeps the database for newly added `HOT` leads and processes them sequentially in the background, preparing the entire day's pipeline automatically.

### 4. Enterprise CRM Webhooks
Blostem is built to integrate. The "Push to CRM" feature doesn't just play an animation—it fires a live, structured JSON payload across the internet to a designated webhook, simulating a real-time sync with Salesforce or HubSpot.

### 5. Client-Side DB Sync Protocol
To prevent data loss from Vercel Serverless CPU freezes during long-running LLM streams, Blostem employs a custom Client-Side Sync Protocol. The frontend explicitly commands a dedicated background route to persist the generated sequences to the database the millisecond the stream completes, ensuring 100% data retention.

---

## 🛠️ Tech Stack & Architecture

* **Framework:** Next.js 14 (App Router)
* **AI Engine:** Vercel AI SDK (`@ai-sdk/react`, `@ai-sdk/google`)
* **Database:** Serverless PostgreSQL (Neon)
* **ORM:** Prisma
* **Validation:** Zod (Strict JSON Schema parsing for LLM outputs)
* **Styling:** Pure CSS Modules

---

## 💻 Running Locally

### 1. Clone the repository
```bash
git clone [https://github.com/YOUR_USERNAME/blostem-ai-engine.git](https://github.com/YOUR_USERNAME/blostem-ai-engine.git)
cd blostem-ai-engine
````

### 2\. Install Dependencies

```bash
npm install
```

### 3\. Set up Environment Variables

Create a `.env.local` file in the root directory and add the following keys:

```env
# Your AI Provider Key (Google Gemini / OpenAI)
AI_API_KEY=your_api_key_here

# Neon PostgreSQL Connection String
DATABASE_URL=your_neon_db_url_here

# For testing the CRM Export (Get a free URL from webhook.site)
CRM_WEBHOOK_URL=[https://webhook.site/your-unique-id](https://webhook.site/your-unique-id)
```

### 4\. Initialize the Database

Push the Prisma schema to your Neon database:

```bash
npx prisma db push
```

### 5\. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](https://www.google.com/search?q=http://localhost:3000) with your browser to see the engine in action.

-----

## 🧪 Evaluation Guide (For Hackathon Judges)

If you are evaluating this project, here is the fastest way to experience the full power of the engine:

1.  **Test the Signal Detection:** Click **+ ADD LEAD**. Enter "NeoVault Financial" and paste a raw news snippet about them raising a Series B to fix their "legacy API tech debt." Click **Detect Signals with AI** and watch the engine isolate the pain point and score the lead.
2.  **Test the Streaming:** Select a lead in the sidebar and click **Generate Outreach Sequence**. Watch the UI stream the results live.
3.  **Test Auto-Pilot:** Ensure you have multiple "HOT" leads in your sidebar without sequences. Click **🚀 RUN AUTO-PILOT** and watch the database populate autonomously.
4.  **Test the Webhook:** Have a [webhook.site](https://webhook.site/) tab open. In Blostem, select a completed lead and click **Push to CRM**. Watch the highly-structured JSON payload instantly arrive at the webhook URL.

-----

*Built with precision for the future of automated sales infrastructure.*

```

**Next Steps:**
1. Replace `YOUR_VERCEL_URL_HERE` at the top with your actual Vercel link.
2. Replace `YOUR_USERNAME` in the clone command with your GitHub username.
3. Commit and push this to your repository!
```
