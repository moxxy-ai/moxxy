export default {
  id: 'google',
  display_name: 'Google Gemini',
  api_key_env: 'GOOGLE_API_KEY',
  api_base: 'https://generativelanguage.googleapis.com/v1beta',
  models: [
    { model_id: 'gemini-3.1-pro', display_name: 'Gemini 3.1 Pro' },
    { model_id: 'gemini-2.5-pro', display_name: 'Gemini 2.5 Pro' },
    { model_id: 'gemini-2.5-flash', display_name: 'Gemini 2.5 Flash' },
    { model_id: 'gemini-2.0-flash', display_name: 'Gemini 2.0 Flash' },
  ],
};
