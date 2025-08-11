# Deployment Guide

## Environment Configuration

This application requires specific environment variables to be set for proper functionality. These variables are used for connecting to Supabase and other services.

### Required Environment Variables

- `REACT_APP_SUPABASE_URL`: Your Supabase project URL
- `REACT_APP_SUPABASE_ANON_KEY`: Your Supabase anonymous key

### Development Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in the environment variables in `.env` with your actual values

3. Start the development server:
   ```bash
   npm start
   ```

### Production Deployment

When deploying to production, ensure you set up these environment variables in your hosting platform:

#### Vercel
- Add environment variables in the Vercel project settings
- Ensure you check "Production" when adding the variables

#### Netlify
- Add environment variables in Site settings > Build & deploy > Environment
- Make sure to trigger a new deployment after adding variables

#### Docker
If using Docker, pass environment variables using:
```bash
docker run -e REACT_APP_SUPABASE_URL=your_url -e REACT_APP_SUPABASE_ANON_KEY=your_key ...
```

### Security Notes

- Never commit `.env` files to version control
- Use different Supabase projects/credentials for development and production
- Regularly rotate your Supabase keys
- Monitor your Supabase usage and set up appropriate rate limiting
