# FamilyOS

FamilyOS is a shared household command center. Its language separates the
household and its people from the displays and external providers used to
present their information.

## Household

**Household**:
The single family group represented by one FamilyOS Server Installation.
_Avoid_: Tenant, account

**Server Installation**:
The one local FamilyOS instance that holds a Household's shared configuration
and serves all of its Displays.
_Avoid_: Kiosk, device

**Display**:
A presentation endpoint through which people view and control the Household.
A Household may have several Displays.
_Avoid_: Server, Household

**Trusted Display**:
A Display that has been paired with the Household and may read or change its
data.
_Avoid_: User, member session

**Household Time Zone**:
The single time zone that defines dates, day boundaries, and calendar views on
every Display.
_Avoid_: Display time zone, browser time zone

## People and events

**Household Member**:
One person represented in the Household calendar. A member is a presentation
identity, not a login or Google account.
_Avoid_: User, account, group

**Active Member**:
A Household Member who may be selected as an Event Participant. A Household
has at most six active members.
_Avoid_: Enabled user

**Retired Member**:
A former active member retained so existing events still identify the person.
A retired member cannot be selected for new events.
_Avoid_: Deleted member

**Event Participant**:
A Household Member explicitly associated with an event by the member's stable
identity. Event colors do not establish participation.
_Avoid_: Event owner, attendee

**Household Event**:
An event with no Event Participants. It remains visible regardless of member
filters.
_Avoid_: Unassigned event

**Household Calendar**:
The one Google calendar currently selected as the Household's authoritative
event source.
_Avoid_: Local calendar, calendar aggregate

**Five-Day View**:
The calendar's rolling view of five consecutive days, initially today and the
next four days.
_Avoid_: Week view

## Lists and providers

**Provider Connection**:
The Household-level Google authorization used to access Calendar and Tasks.
It is separate from Household Member identity.
_Avoid_: Member login, FamilyOS account

**Household Configuration**:
The shared, versioned settings of one Household — family name, members,
Household Calendar, and selected Household Lists.
_Avoid_: Kiosk settings, device preferences

**Household List**:
A Google tasklist explicitly selected in Household Configuration for display
in FamilyOS. Its identity is the provider tasklist ID. Unselected Google
tasklists are not Household Lists.
_Avoid_: Task panel, selected tasklist

**List Item**:
A checkable entry in a Household List.
_Avoid_: Task, chore

**Chore**:
A future assigned household responsibility belonging to the Tasks product
surface, not to Lists.
_Avoid_: List Item
