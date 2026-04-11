# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: new_user/schedule.spec.ts >> PPV flow via schedule
- Location: tests/new_user/schedule.spec.ts:26:5

# Error details

```
Test timeout of 240000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e9]:
    - generic [ref=e11]:
      - button [ref=e13]:
        - img [ref=e15] [cursor=pointer]
      - heading "Choose how to buy" [level=1] [ref=e17]:
        - paragraph [ref=e20]: Choose how to buy
    - generic [ref=e28]:
      - group [ref=e30]:
        - paragraph [ref=e35]:
          - text: Buy
          - strong [ref=e36]: Wardley vs. Dubois
          - text: with DAZN Standard or
          - strong [ref=e37]: get it included in DAZN Ultimate.
        - generic [ref=e38] [cursor=pointer]:
          - radio "Wardley vs. Dubois ₹1,812 +DAZN Standard ppv t wardley dubois Wardley vs. Dubois Sat 9th May at 23:30" [checked]
          - generic [ref=e39]:
            - generic [ref=e40]:
              - paragraph [ref=e46]: Wardley vs. Dubois
              - generic [ref=e48]:
                - generic [ref=e50]: ₹1,812
                - generic [ref=e51]: +DAZN Standard
            - generic [ref=e55]:
              - img "ppv t wardley dubois" [ref=e57]
              - generic [ref=e58]:
                - generic [ref=e60]: Wardley vs. Dubois
                - generic [ref=e61]: Sat 9th May at 23:30
        - generic [ref=e62] [cursor=pointer]:
          - radio "DAZN Ultimate From ₹1,775 / month Annual contract. Auto renews. ppv t wardley dubois Wardley vs. Dubois Sat 9th May at 23:30 tick icon Included tick-golden Pay-per-views included at no extra cost. Minimum of 12 events per year including Chisora vs. Wilder & Wardley vs. Dubois. tick-golden HDR and Dolby 5.1 surround sound on select events. tick-golden 185+ fights a year from the best promoters Whats included"
          - paragraph [ref=e63]:
            - paragraph [ref=e65]: Pay-per-views included
          - generic [ref=e67]:
            - generic [ref=e68]:
              - paragraph [ref=e73]: DAZN Ultimate
              - generic [ref=e76]:
                - generic [ref=e79]:
                  - generic [ref=e80]: From
                  - generic [ref=e81]: ₹1,775
                  - generic [ref=e82]: / month
                - generic:
                  - generic:
                    - paragraph
                - paragraph [ref=e85]: Annual contract. Auto renews.
            - generic [ref=e89]:
              - img "ppv t wardley dubois" [ref=e91]
              - generic [ref=e92]:
                - generic [ref=e94]: Wardley vs. Dubois
                - generic [ref=e95]: Sat 9th May at 23:30
                - generic [ref=e96]:
                  - img "tick icon" [ref=e97]
                  - paragraph [ref=e98]: Included
            - generic [ref=e99]:
              - generic [ref=e100]:
                - img "tick-golden" [ref=e101]
                - paragraph [ref=e102]:
                  - paragraph [ref=e104]:
                    - text: Pay-per-views included at no extra cost. Minimum of 12 events per year including
                    - strong [ref=e105]: Chisora vs. Wilder & Wardley vs. Dubois.
              - generic [ref=e106]:
                - img "tick-golden" [ref=e107]
                - paragraph [ref=e108]:
                  - paragraph [ref=e110]: HDR and Dolby 5.1 surround sound on select events.
              - generic [ref=e111]:
                - img "tick-golden" [ref=e112]
                - paragraph [ref=e113]:
                  - paragraph [ref=e115]: 185+ fights a year from the best promoters
            - generic [ref=e116]:
              - heading "Whats included" [level=4] [ref=e117]
              - img [ref=e119]
      - button "Continue" [ref=e122] [cursor=pointer]:
        - paragraph [ref=e125]:
          - generic [ref=e126]: Continue
      - button "Subscribe without a pay-per-view" [ref=e127] [cursor=pointer]:
        - generic [ref=e128]: Subscribe without a pay-per-view
  - iframe [ref=e129]:
    
```