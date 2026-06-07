<p align="center">
  <img src="public/logo.png" alt="Nookly Logo" width="200" />
</p>

# Nookly

Nookly is a smart document management app built with Next.js. It lets you upload, parse, and interact with your PDFs — turning static documents into searchable, organized knowledge.

## Features

- **📄 PDF Upload & Parsing** — Upload PDFs and let Nookly extract and index the content automatically.
- **🔍 Full-Text Search** — Search across all your documents to find exactly what you need, fast.
- **🤖 AI-Powered Q&A** — Ask questions about your documents and get answers grounded in their content.

## Getting Started

### Local Development

First, install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Docker

```bash
# Clone the repository
git clone https://github.com/TimHoogervorst/Nookly.git
cd Nookly

# Set admin credentials (only used to seed the first user)
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=your-secure-password

# Start with Docker Compose
docker compose up -d
```

The app will be available at [http://localhost:3000](http://localhost:3000). Data is persisted in a Docker volume (`pdfai_data`).

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` to seed the initial admin account on first launch. These are only used when the database has no existing users — once created, you can change the password from the Settings page.

## License

[MIT](LICENSE)
