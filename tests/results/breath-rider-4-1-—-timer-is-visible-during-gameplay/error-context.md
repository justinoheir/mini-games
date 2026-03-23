# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - button "Back to all games" [ref=e4] [cursor=pointer]: ←
      - generic [ref=e5]:
        - img [ref=e7]
        - generic [ref=e11]: Breath Rider
      - button "Mute" [ref=e13] [cursor=pointer]: 🔊
    - generic [ref=e14]:
      - generic [ref=e15]:
        - img [ref=e18]
        - heading "Breath Rider" [level=1] [ref=e22]
        - paragraph [ref=e23]: Blow into the mic to make the rider climb. Collect coins and avoid spikes.
        - button "Allow Mic & Play →" [active] [ref=e24] [cursor=pointer]
        - paragraph [ref=e25]: Uses microphone
      - generic [ref=e28]:
        - generic [ref=e29]: 🔒
        - heading "One last thing" [level=2] [ref=e30]
        - paragraph [ref=e31]: Your gameplay data will be collected to measure the impact of this experience. We don't sell your data.
        - button "I Agree & Play" [ref=e32] [cursor=pointer]:
          - text: I Agree & Play
          - img [ref=e33]
        - button "← Go back" [ref=e35] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e46] [cursor=pointer]:
    - img [ref=e47]
  - alert [ref=e52]
```