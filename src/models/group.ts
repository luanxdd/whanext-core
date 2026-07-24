export type GroupAccess = 
  | 'open'
  | 'closed';

export type GroupRole = 
  | 'member'
  | 'admin'
  | 'owner';

export type GroupAddressingMode = 
  | 'lid'
  | 'pn';

export type GroupParticipantAction = 
  | 'add'
  | 'remove'
  | 'promote'
  | 'demote'
  | 'modify';

export interface GroupParticipantsChanged {
  groupId: string;
  action: GroupParticipantAction;
  participantIds: string[];
  authorId?: string;
}

export interface GroupParticipant {
  id: string;
  lid?: string;
  phoneNumber?: string;
  role: GroupRole;
}

export interface GroupSnapshot {
  id: string;
  subject: string;
  access: GroupAccess;
  addressingMode: GroupAddressingMode;
  participants: GroupParticipant[];
  fetchedAt: Date;
}

export type ChangeResult<State extends string> =
  | { ok: true; changed: true; state: State }
  | { ok: true; changed: false; state: State };

export interface InviteResult {
  ok: true;
  url: string;
  code: string;
}

export type MemberAction = 
  | 'removed'
  | 'promoted'
  | 'demoted';

export type MemberActionState =
  | MemberAction
  | 'already_removed'
  | 'already_admin'
  | 'not_admin'
  | 'not_in_group';