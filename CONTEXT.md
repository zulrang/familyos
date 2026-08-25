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

**Display Configuration**:
The settings that belong to one Display rather than the Household. Display
size, Idle Dim, and Wall Controls are Display Configuration.
_Avoid_: Device preferences, kiosk settings, household settings

**Idle Dim**:
A Display's reduction of panel brightness after a period without input. Input
restores the previous brightness.
_Avoid_: Screen saver, sleep, DPMS, screen blank, dimming overlay

**Wall Controls**:
A Display Configuration: this Display uses FamilyOS large-target controls in
place of the browser's date and time widgets.
_Avoid_: Kiosk mode, touch mode, time picker setting

**Household Time Zone**:
The single time zone that defines dates, day boundaries, and calendar views on
every Display.
_Avoid_: Display time zone, browser time zone

## People and events

**Household Member**:
One person represented in the Household calendar. A member is a presentation
identity, not a login or Google account. Identity is a stable ID; email is not
part of the model.
_Avoid_: User, account, group

**Member Color**:
The FamilyOS presentation color for an Active Member. It is chosen in FamilyOS
and is independent of Google Calendar colors.
_Avoid_: Tone, Google color, colorId

**Active Member**:
A Household Member who may be selected as an Event Participant. A Household
has at most six active members. Each holds a Member Color unique among active
members.
_Avoid_: Enabled user

**Retired Member**:
A former active member retained so existing events still identify the person.
A retired member cannot be selected for new events and does not hold a Member
Color — retirement frees that color for reuse.
_Avoid_: Deleted member

**Event Participant**:
A Household Member explicitly associated with an event by the member's stable
identity. Member Color does not establish participation.
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

## Tasks

**Task**:
An assigned household responsibility on the Tasks product surface. Every Task
is either a Chore or a Routine.
_Avoid_: List Item, to-do, chore (as the umbrella term)

**Chore**:
A Task of work done for the household, such as dishes or trash.
_Avoid_: Task (when the type matters), List Item

**Routine**:
A Task that is a recurring personal-care step, such as brushing teeth.
Identical to a Chore in everything but the label.
_Avoid_: habit

**Task Definition**:
The description of a Task — title, type, recurrence, and assignment. An edit
replaces a definition with a new version rather than changing it in place.
_Avoid_: template

**Lineage**:
The stable identity of a Task across edits of its Task Definition.
_Avoid_: task id

**Occurrence**:
One dated instance of a Task within a single Window.
_Avoid_: instance, entry

**Window**:
The span from an Occurrence's scheduled date until the Task's next scheduled
date. The Occurrence stays open and due for its whole Window, then expires.
_Avoid_: due date, deadline

**Rotation**:
An assignment that passes among Active Members in a fixed order, advancing one
turn each time an Occurrence is completed — fairness by turns taken, not by
dates elapsed.
_Avoid_: schedule

**Open Assignment**:
An assignment with no designated member; the first Active Member to Claim the
Occurrence takes it. An unclaimed Occurrence belongs to the Household, not to
a member.
_Avoid_: unassigned

**Claim**:
An Active Member taking an open Occurrence for themselves. A Claim is
advisory; completion is what counts.
_Avoid_: lock, reservation

**Skip**:
Marking an Occurrence intentionally not done for its Window. A Skip never
advances a Rotation.
_Avoid_: dismiss, delete

**Star**:
The unit of reward a Task carries. Completing an Occurrence earns the Task's
star value for the completing member. Chores and Routines earn identically.
_Avoid_: point, credit

**Star Balance**:
A member's earned Stars adjusted by any recorded redemptions or corrections.
It is always derived, never stored.
_Avoid_: score, wallet, points total
