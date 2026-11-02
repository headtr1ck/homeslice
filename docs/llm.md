# Setting up your home with an AI assistant

A Homeslice house is short, readable [YAML](yaml.md) with clear errors, so an AI assistant
can draw the house from a photo or sketch of your floor plan, or change it for you. It needs
the format and your Home Assistant's floors, areas and devices; Homeslice provides both,
checks what the assistant wrote with the editor's rules, and keeps the previous version so
any save can be undone (editor → ⚙ → *Restore the version from …*).

The guide the assistants get is
[`custom_components/homeslice/guide.md`](../custom_components/homeslice/guide.md); served
by Home Assistant, it also lists your real floors, areas and entities.

## Any chat assistant (ChatGPT, Claude, Gemini…)

Editor → ⚙ → *Copy prompt for an AI assistant*. Paste it into the chat with your floor
plan, paste the answer into *Replace the house with this YAML*, and if it has mistakes,
*Copy errors for the assistant* gives them back to it.

## Home Assistant's own assistant (LLM API)

In a conversation agent's settings (OpenAI, Anthropic, Google, Ollama…), add the API
**Homeslice** next to *Assist*. It gets four tools: `homeslice_get_guide`,
`homeslice_get_house`, `homeslice_validate_house` and `homeslice_save_house` (saving needs
an administrator).

## External assistants over MCP (Claude Code, Claude Desktop, Cursor…)

Add Home Assistant's **MCP Server** integration and pick the *Homeslice* API there; the
assistant connects with a long-lived access token and gets the same tools.

## Scripts and assistants without MCP (HTTP API)

The HTTP API, with a long-lived access token (`Authorization: Bearer …`):

```sh
curl -H "Authorization: Bearer $TOKEN" http://homeassistant:8123/api/homeslice/guide            # the guide with your floors, areas, entities
curl -H "Authorization: Bearer $TOKEN" http://homeassistant:8123/api/homeslice/houses/home      # the house as YAML
curl -X POST --data-binary @home.yaml -H "Authorization: Bearer $TOKEN" http://homeassistant:8123/api/homeslice/validate
curl -X PUT  --data-binary @home.yaml -H "Authorization: Bearer $TOKEN" http://homeassistant:8123/api/homeslice/houses/home   # admins
curl -X POST -H "Authorization: Bearer $TOKEN" http://homeassistant:8123/api/homeslice/houses/home/restore                     # admins
```

## Coding assistants working on Homeslice itself

[AGENTS.md](../AGENTS.md) describes the code, its rules and step-by-step recipes; coding
assistants read it on their own.
