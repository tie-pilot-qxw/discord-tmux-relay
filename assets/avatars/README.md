# Avatar gallery

Square PNG portraits for the Discord server icon and model-specific message identities. These are AI-generated, community-inspired illustrations created with the built-in image generation tool for this project; they are not official OpenAI or Anthropic artwork.

The archive includes design experiments as well as selected portraits. Version numbers preserve the design iteration order; a higher number does not mean every earlier design was used in Discord.

## Selected files

| Server icon | Claude | Codex |
| --- | --- | --- |
| <img src="server.png" width="160" alt="Dual-character server icon"> | <img src="claude.png" width="160" alt="Orange-haired Claude portrait"> | <img src="codex.png" width="160" alt="Silver-haired Codex portrait"> |
| [server.png](server.png) · recentered square variant | [claude.png](claude.png) · original single-character portrait | [codex.png](codex.png) · v13, selected on November 13, 2026 |

The selected copies are byte-identical to their archived versions where applicable. All archived PNGs retain their original resolution.

## Using the portraits

- **Server icon:** upload `server.png` in Discord's server settings. The rounded and earlier square alternatives are below.
- **Model replies:** copy `claude.png` and `codex.png` into the relay data directory's `avatars/` folder. Enable `modelAvatars` and grant Manage Webhooks as described in the [setup guide](../../README.md#model-specific-avatars).
- **Existing model webhooks:** replacing the files only sets the source for newly created webhooks. Update the avatar of each existing `Relay · Claude` or `Relay · Codex` webhook in the relevant channel's Integrations settings as well.

Use the full square image when uploading. The Discord client applies its own avatar mask. Check the result at small message-avatar sizes before choosing a version.

## Server icon versions

| Version | Preview | Notes |
| --- | --- | --- |
| [v1-rounded.png](server/v1-rounded.png) | <img src="server/v1-rounded.png" width="128" alt="Server icon v1"> | Original circular border with white corners. |
| [v2-square.png](server/v2-square.png) | <img src="server/v2-square.png" width="128" alt="Server icon v2"> | Full-bleed square, without the circular border. |
| [v3-recentered.png](server/v3-recentered.png) | <img src="server/v3-recentered.png" width="128" alt="Server icon v3"> | Composition shifted slightly right. Used for the selected server.png copy. |

## Codex versions

| Version | Preview | Design notes |
| --- | --- | --- |
| [v00-original](codex/v00-original.png) | <img src="codex/v00-original.png" width="128" alt="Codex v00-original"> | Original portrait with crossed sashes and a flower ornament. |
| [v01](codex/v01.png) | <img src="codex/v01.png" width="128" alt="Codex v01"> | First sash-removal study. |
| [v02](codex/v02.png) | <img src="codex/v02.png" width="128" alt="Codex v02"> | Loose garment study. |
| [v03](codex/v03.png) | <img src="codex/v03.png" width="128" alt="Codex v03"> | Fitted qipao reconstruction from a costume reference. |
| [v04](codex/v04.png) | <img src="codex/v04.png" width="128" alt="Codex v04"> | Revised shoulder/chest framing and proportions. |
| [v05](codex/v05.png) | <img src="codex/v05.png" width="128" alt="Codex v05"> | Small fabric frog closures. |
| [v06](codex/v06.png) | <img src="codex/v06.png" width="128" alt="Codex v06"> | Softer fabric shading. |
| [v07](codex/v07.png) | <img src="codex/v07.png" width="128" alt="Codex v07"> | Increased satin sheen. |
| [v08](codex/v08.png) | <img src="codex/v08.png" width="128" alt="Codex v08"> | Lighter central fabric panel. |
| [v09](codex/v09.png) | <img src="codex/v09.png" width="128" alt="Codex v09"> | Broader fabric highlights. |
| [v10](codex/v10.png) | <img src="codex/v10.png" width="128" alt="Codex v10"> | Short sleeves and a diagonal fastening. |
| [v11](codex/v11.png) | <img src="codex/v11.png" width="128" alt="Codex v11"> | Symmetric brocade with prominent gold embroidery. |
| [v12](codex/v12.png) | <img src="codex/v12.png" width="128" alt="Codex v12"> | Simplified bodice with decoration concentrated at the collar. |
| [v13](codex/v13.png) | <img src="codex/v13.png" width="128" alt="Codex v13"> | Return to the original portrait, removing the sashes while retaining the ornaments. Current selected Codex portrait. |

## Claude portrait

The original single-character [Claude portrait](claude.png) is included above. No separate revised Claude portraits were saved in this collection.
