import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { CredentialVault } from "./credential-store.js";
import { storedTokensSchema, type StoredTokens } from "./models.js";

export interface TokenStoreIdentity {
  serverOrigin: string;
  issuer: string;
  clientId: string;
  organizationId?: string;
}

export class TokenStore {
  constructor(private readonly vault: CredentialVault) {}

  service(identity: TokenStoreIdentity): string {
    return `org.stagepilot.multitracks-cues:${new URL(identity.serverOrigin).origin}:${new URL(identity.issuer).origin}`;
  }

  account(identity: TokenStoreIdentity): string {
    return `${identity.clientId}:${identity.organizationId ?? "unselected"}`;
  }

  async load(identity: TokenStoreIdentity): Promise<StoredTokens | undefined> {
    const raw = await this.vault.get(this.service(identity), this.account(identity));
    if (!raw) return undefined;
    return storedTokensSchema.parse(JSON.parse(raw));
  }

  async save(identity: TokenStoreIdentity, tokens: OAuthTokens | StoredTokens): Promise<StoredTokens> {
    const stored = storedTokensSchema.parse({ ...tokens, obtainedAt: Date.now() });
    await this.vault.set(this.service(identity), this.account(identity), JSON.stringify(stored));
    return stored;
  }

  async delete(identity: TokenStoreIdentity): Promise<void> {
    await this.vault.delete(this.service(identity), this.account(identity));
  }

  async loadClientSecret(identity: TokenStoreIdentity): Promise<string | undefined> {
    return (await this.vault.get(this.service(identity), `${identity.clientId}:client-secret`)) ?? undefined;
  }

  async saveClientSecret(identity: TokenStoreIdentity, secret: string): Promise<void> {
    await this.vault.set(this.service(identity), `${identity.clientId}:client-secret`, secret);
  }

  async deleteClientSecret(identity: TokenStoreIdentity): Promise<void> {
    await this.vault.delete(this.service(identity), `${identity.clientId}:client-secret`);
  }

  expiresAt(tokens: StoredTokens): number | undefined {
    return tokens.expires_in ? tokens.obtainedAt + tokens.expires_in * 1000 : undefined;
  }

  isExpired(tokens: StoredTokens, skewMs = 60_000): boolean {
    const expiry = this.expiresAt(tokens);
    return expiry !== undefined && expiry <= Date.now() + skewMs;
  }
}
