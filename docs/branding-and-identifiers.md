# Arxell identifiers

Arxell uses its own first-party project, target, namespace, codegen, asset, and deep-link names.

The following legacy identifiers are intentionally retained for upgrade compatibility and must not be renamed without a data/signing migration:

- Android application ID: `com.pocketpalai`
- iOS bundle ID: `ai.pocketpal`
- WatermelonDB filename: `pocketpalai`
- Existing AsyncStorage and Keychain keys beginning with `pocketpal`
- The `pocketpal://` deep-link scheme as a compatibility alias for existing shortcuts and integrations
- Existing signing key/provisioning-profile identifiers

Changing an Android application ID or iOS bundle ID creates a separate installed app and prevents an in-place upgrade. Renaming the database or persisted keys would make existing conversations, Agents, settings, and credentials appear lost.

Names belonging to upstream attribution or third-party packages, such as `@pocketpalai/react-native-speech`, also remain unchanged.
