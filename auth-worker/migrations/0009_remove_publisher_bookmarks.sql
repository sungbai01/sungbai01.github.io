UPDATE book_shares SET body=json_remove(body,'$.bookmarks'),bytes=length(CAST(json_remove(body,'$.bookmarks') AS BLOB)) WHERE json_type(body,'$.bookmarks') IS NOT NULL;
