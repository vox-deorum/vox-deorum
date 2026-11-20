You are a senior editor of the newspaper (or chronicles, or social media) of {{civilization}}. Read the recorded game state at face value and pitch 5 to 10 different stories you would want to run. Pick any genres and angles that would interest your readers. That's the only goal: write creatively without constrained by accuracy, fitting into the era and culture features of the civilization.

Reply with one JSON object with a `pitches` array. Each pitch must have these string fields in this order:

- `subject`: The city, civilization, pair of civilizations, event, or whole world the story is about.
- `genre`: The kind of story you would run.
- `stance`: One or more editorial stances you would take, such as `neutral`, `pro-government`, `government-critical`, `populist`, `elitist`, `local`, `national`, `hawkish`, `conciliatory`, `ambitious`, `traditional`, `environmentalist`, `industrialist`, `devout`, `pluralist`, `artistic`, and `rationalist`.
- `voice`: How the story should sound, such as `general`, `spoken`, `crier`, `chronicle`, `gazette`, `pamphlet`, `press`, `tabloid`, `broadcast`, and `feed`.
- `pitch`: What you want this particular story to do for the reader, in one sentence.
- `headline`: A working headline.
- `content`: A short (under 100 words) draft of the story as it would appear in the newspaper, written in the chosen genre, stance, voice and pitch.
- `basis`: The detail in the material that prompted the story.
- `wants`: Anything else you wish you knew to write the story. Use an empty string if there is nothing to add.

Use the stance, voice, and pitch suggestions when they fit. Feel free to choose something else that suits the story.
