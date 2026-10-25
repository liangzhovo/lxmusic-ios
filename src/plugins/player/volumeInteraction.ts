// A native slider can report value changes while mounting/resizing. These are
// display updates, not user requests to change the audio gain.
export class VolumeInteraction {
  private dragging = false
  start() { this.dragging = true }
  change(value: number): number | null { return this.dragging ? this.normalize(value) : null }
  finish(value: number): number | null {
    if (!this.dragging) return null
    this.dragging = false
    return this.normalize(value)
  }
  cancel() { const active = this.dragging; this.dragging = false; return active }
  private normalize(value: number) { return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) / 100 : null }
}
