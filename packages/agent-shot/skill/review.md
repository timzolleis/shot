# shot review: let the user choose

`shot review` opens a local page with the labels you name side by side. The user votes per sheet, draws pins, boxes, arrows and pen strokes on the stills, and sends it back. Nothing goes to the PR.

1. Shoot each variant with the same flags and its own label. Variants behind a URL param line up: `shot "/app/persons?variant=quiet" --as admin --label quiet --section People --size phone --size desktop`. Shoot the current state as `--label before` if the user should compare against it.
2. Read every PNG first. A variant that fails `--check` or looks broken is not a candidate.
3. Put up exactly what the user should judge, in your order:

   ```sh
   shot review quiet editorial dense --base before --ask "Pick a density for People" \
     --describe quiet="Lowest weight; least memorable" \
     --describe dense="Most rows per screen; smaller hit areas"
   ```

   `--sheet <part of a title>` and `--size <size>` narrow it. `--describe` states each label's direction and cost; never mark a favourite.

4. It blocks until the user sends or closes the page, which can take long. Run it in the background with no timeout and read stdout when it exits. Do not kill it or poll it.
5. Exit 0: stdout is the feedback: the pick, per sheet the vote and numbered notes with the element under each, and PNGs with the drawings burned in. Read those PNGs and act on them. Exit 1 `closed without feedback`: ask in chat.
6. Another round: change the code, reshoot the same labels, run `shot review` again. The last round's drawings show faded.
