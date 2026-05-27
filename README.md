<div align="center">
<img width="800" height="300" alt="JP Masajes Logo" src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80" />
</div>

# Jean Pierre - Sistema de Citas para Masajes

Sistema de gestión de citas para un estudio de masajes con reservas online, panel de administración y asistente virtual.

## Características

### Para Clientes
- **Reserva online**: Selección de fecha, hora y tipo de massage
- **Asistente virtual (Bot)**: Consultar, reagendar o cancelar citas existentes
- **Confirmación por email**: Recibes confirmación de tu cita automáticamente

### Para Administrador
- **Panel de administración**: 
  - Gestión de horarios (mañana/tarde)
  - Tipos de massage disponibles
  - Imagen del estudio
  - Ver próximas citas
- **Historial e ingresos**:
  - Registro de todas las citas
  - Citas completadas vs pendientes
  - Control de ingresos por massage
- **Integración con Google Calendar**: Las citas se añaden automáticamente

## Tecnologías

- **Frontend**: React + TypeScript + Tailwind CSS + Framer Motion
- **Backend**: Node.js + Express + better-sqlite3
- **Autenticación**: Google OAuth 2.0
- **Email**: Gmail API

## Instalación Local

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
# Crear archivo .env con:
# GOOGLE_CLIENT_ID=tu_client_id
# GOOGLE_CLIENT_SECRET=tu_client_secret
# GEMINI_API_KEY=tu_api_key (opcional)

# Ejecutar en desarrollo
npm run dev
```

## Variables de Entorno Requeridas

| Variable | Descripción |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Client ID de Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Client Secret de Google Cloud Console |
| `APP_URL` | URL de la aplicación (ej: http://localhost:3000) |

## Estructura del Proyecto

```
├── src/
│   └── App.tsx          # Frontend principal
├── server.ts            # Backend API
├── package.json         # Dependencias
└── database.sqlite      # Base de datos SQLite
```

## Acceso Admin

Para acceder al panel de administración:
1. Añadir `?admin=true` a la URL (ej: `http://localhost:3000/?admin=true`)
2. Autenticarse con Google

---
</div>