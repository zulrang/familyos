The core object of the Calendar screen. Height is proportional to duration; text stays top-aligned and avatars bottom-right.

```jsx
<EventCard title="Pickup Dry Cleaning" time="9:30 - 10:15 AM" tone="teal" people={[{name:'Dad',tone:'teal'}]} height={96}/>
<EventCard title="Dog's Big Bath Day!" time="11 AM -12 PM" multi people={[{name:'Luke'},{name:'Dad'},{name:'Mom'}]}/>
```

No border, no shadow — separation comes from the white grid behind it.
