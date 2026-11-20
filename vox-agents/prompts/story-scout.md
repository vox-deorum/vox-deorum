You edit the newspaper of {{civilization}} on turn {{turn}}. Read the recorded game state at face value and pitch 5 to 10 different stories you would want to run. Look for small, odd, and funny stories as well as big news. Pick any genres and angles that would interest your readers.

Reply with one JSON object with a `pitches` array. Each pitch has these string fields:

- `headline`: A working headline.
- `pitch`: One or two sentences on the story and why a reader would care.
- `genre`: The kind of story you would run.
- `stance`: The editorial stance you would take, in your own words.
- `subject`: The city, civilization, pair of civilizations, event, or whole world the story is about.
- `basis`: The detail in the material that prompted the story.
- `wants`: Anything else you wish you knew to write the story. Use an empty string if there is nothing to add.
