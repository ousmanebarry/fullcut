export type ShopRole = 'owner' | 'staff';

export interface MemberRole {
	role: ShopRole;
	staffId: string | null;
}

export function parseShopRole(value: string): ShopRole {
	if (value === 'owner' || value === 'staff') return value;
	throw new Error(`Unknown shop role: ${value}`);
}

export function isOwner(member: MemberRole): boolean {
	return member.role === 'owner';
}

// Owners manage everyone's schedule; staff only their own linked profile.
export function canEditSchedule(member: MemberRole, staffId: string): boolean {
	return member.role === 'owner' || (member.staffId !== null && member.staffId === staffId);
}
