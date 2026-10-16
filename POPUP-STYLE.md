# XDM Browser Monitor Popup Style

This document describes the current popup visual system implemented in
[`status.html`](./status.html).

## Layout

- Fixed popup width: `380px`.
- Horizontal overflow is hidden.
- The popup grows vertically as captured media rows are added.
- The header contains the product name and compact icon actions.
- The status card appears below the header.
- The detected-media section follows the status card.

## Header actions

Actions are ordered from left to right:

1. Power: enable or pause extension monitoring.
2. Settings: open the extension options page.
3. Site: pause or resume monitoring for the current hostname.
4. Clear: open the inline clear confirmation.
5. Refresh: request a fresh XDM synchronization and reload the active tab's list.
6. Retry: retry the XDM connection; this is shown when XDM is unavailable.

All icon actions are semantic buttons with an `aria-label` and a `title`
tooltip. Icons are inline SVGs so they do not depend on external font files.

## Color palette

| Token | Value | Usage |
| --- | --- | --- |
| Canvas | `#F4F7FB` | Popup background |
| Surface | `#FFFFFF` | Cards, rows, and controls |
| Muted surface | `#EEF3F8` | Hover backgrounds |
| Text | `#14243A` | Primary text |
| Muted text | `#5D6B7D` | Supporting text and metadata |
| Border | `#DBE3ED` | Dividers and control borders |
| Primary | `#2563EB` | Primary accent |
| Success | `#147D54` | Active monitoring |
| Warning | `#9A5B00` | Paused or limited monitoring |
| Error | `#B42318` | XDM unavailable and destructive confirmation |

## Status card states

- Active or manual-download mode uses a subtle green background:
  `#EDF9F2`.
- Paused or stopped monitoring uses a subtle gray background:
  `#F5F6F7`.
- XDM unavailable uses a subtle red background:
  `#FFF1F0`.
- The card has a `1px` border, `11px` radius, and a light shadow.

## Media rows

Each media row uses a four-column CSS grid:

- The filename occupies columns 1–3, approximately 90% of the row.
- The metadata rail occupies column 4, approximately 10%.
- The filename wraps to a maximum of three lines.
- Metadata pills are stacked vertically and show:
  - File size or `size`
  - File extension/type or `type`
  - Video resolution or `res`

Rows use subtle borders and a light blue hover/selection background.

The popup uses confirmed XDM media records for visible rows. The MV2 background
filters the XDM `/sync` list by the active tab ID before rendering, preventing
media from another tab from appearing in the current popup.

The badge count is per browser tab and represents the same XDM-confirmed media rows
ledger shown for the active tab. Existing XDM items from before the current
extension session are not displayed as newly captured media. Per-tab badges are
cleared when the background page starts and refreshed when tabs are switched.

Rows are deduplicated by browser tab ID and resource pathname, so signed URL
query-string changes after a page refresh do not create repeated visual entries
or inflate the badge. A media item from XDM is shown in a tab only when its tab
metadata or safe URL/filename/info correlation identifies that tab.

## Confirmation treatment

Clearing media uses an inline confirmation panel inside the popup instead of
the browser's native warning dialog. The panel uses a pale red background,
rounded corners, and explicit **Cancel** and **Clear** actions.

## Accessibility

- Icon-only controls use semantic `<button>` elements.
- Every icon button has an accessible label and tooltip.
- Status and action messages use `aria-live`.
- Media entries are keyboard-focusable buttons.
- Focus-visible controls receive a purple focus ring.
