# Web Push Notifications Setup

Skypier uses the standard Web Push API (via the VAPID protocol) to deliver real-time, background notifications to users even when the app is closed.

To preserve end-to-end encryption and user privacy, the notification payloads proxied through browser push services (like Google FCM, Apple APNs, or Mozilla autopush) contain only a generic `{"type": "NEW_MESSAGE"}` trigger. No plaintext message content or sender identities are ever leaked to the push provider. The Service Worker receives this trigger and displays a generic "New message received" alert.

To enable this feature in your own deployment, you must coordinate VAPID configurations between the Relay Server and the Web Client.

## 1. Generating VAPID Keys

You can generate a valid pair of VAPID keys using standard web-push tooling. You can run it directly using `npx`:

```bash
npx web-push generate-vapid-keys
```

Alternatively, you can install the `web-push` package globally and run it:

```bash
npm install -g web-push
web-push generate-vapid-keys
```

This will output a `Public Key` and a `Private Key`.

## 2. Relay Configuration (Server)

The Skypier Relay needs both the Public and Private VAPID keys to sign push requests on behalf of your domain. It also requires a contact address (an email or URL) so that push services can reach out if there are issues.

Add the following to your relay's `config.yaml` (typically located at `/etc/skypier-relay/config.yaml`):

```yaml
# VAPID configuration for Web Push Notifications.
web_push_vapid_public_key: "<YOUR_PUBLIC_KEY>"
web_push_vapid_private_key: "<YOUR_PRIVATE_KEY>"
web_push_contact: "mailto:admin@your-domain.com"
```

Restart your relay service after saving the configuration:

```bash
sudo systemctl restart skypier-relay
```

## 3. Web Client Configuration (Frontend)

The Web App needs your VAPID Public Key to negotiate push subscriptions with the browser. 

Provide it via the environment variables before building the client application by adding it to your `.env` or `.env.production` file:

```env
VITE_WEB_PUSH_VAPID_PUBLIC_KEY="<YOUR_PUBLIC_KEY>"
```

### Rebuilding the Client

After setting the variable, rebuild the frontend:

```bash
pnpm install
pnpm build
```

Once deployed, the frontend client will automatically request Push permissions from users upon first interaction and securely forward their subscription endpoints to the Relay server.