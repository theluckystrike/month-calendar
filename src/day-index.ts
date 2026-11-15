// The notes of each day. A full pass runs only when the pane opens or a setting changes; a create, delete, rename or
// metadata change updates the one file.
import type { IsoDate } from './dates';

export class DayIndex {
	/** Days of each indexed path. */
	private readonly byPath = new Map<string, IsoDate[]>();
	/** Paths of each day, sorted. */
	private readonly byDay = new Map<IsoDate, string[]>();

	/** dayOf gives the days of a path: its daily note day and (Pro) its date property day. null entries are skipped. */
	constructor(private readonly dayOf: (path: string) => (IsoDate | null)[]) {}

	rebuild(paths: Iterable<string>): void {
		this.byPath.clear();
		this.byDay.clear();
		for (const p of paths) this.update(p);
	}

	/** Computes the days of one path again. */
	update(path: string): void {
		this.remove(path);
		const days = [...new Set(this.dayOf(path).filter((d): d is IsoDate => typeof d === 'string'))];
		if (!days.length) return;
		this.byPath.set(path, days);
		for (const d of days) {
			const list = this.byDay.get(d);
			if (!list) {
				this.byDay.set(d, [path]);
				continue;
			}
			// Binary insert keeps the list sorted without a sort of the whole list.
			let lo = 0;
			let hi = list.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if ((list[mid] as string) < path) lo = mid + 1;
				else hi = mid;
			}
			list.splice(lo, 0, path);
		}
	}

	remove(path: string): void {
		const days = this.byPath.get(path);
		if (!days) return;
		this.byPath.delete(path);
		for (const d of days) {
			const list = this.byDay.get(d);
			if (!list) continue;
			const i = list.indexOf(path);
			if (i >= 0) list.splice(i, 1);
			if (!list.length) this.byDay.delete(d);
		}
	}

	rename(oldPath: string, newPath: string): void {
		this.remove(oldPath);
		this.update(newPath);
	}

	/** Paths of the notes of a day, sorted. */
	files(day: IsoDate): string[] {
		return [...(this.byDay.get(day) ?? [])];
	}
}
