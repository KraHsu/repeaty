import type { TranslationCatalogs } from './locales'

/** Core interface labels. Technical explanations fall back to English until translated. */
export const interfaceLocales = [
  'zh-TW',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'pl',
  'pt-BR',
  'ru',
] as const
// Columns: Chinese source key, Traditional Chinese, German, Spanish, French, Italian,
// Japanese, Korean, Polish, Brazilian Portuguese, Russian. User content is never translated.
const labels = `
学习概览|學習概覽|Lernübersicht|Resumen de estudio|Vue d’ensemble|Panoramica studio|学習の概要|학습 개요|Przegląd nauki|Visão geral|Обзор обучения
全部卡片|全部卡片|Alle Karten|Todas las tarjetas|Toutes les cartes|Tutte le schede|すべてのカード|모든 카드|Wszystkie fiszki|Todos os cartões|Все карточки
学习材料|學習材料|Lernmaterialien|Materiales de estudio|Documents d’étude|Materiali di studio|学習資料|학습 자료|Materiały do nauki|Materiais de estudo|Учебные материалы
工作目录|工作目錄|Arbeitsordner|Carpeta de trabajo|Dossier de travail|Cartella di lavoro|作業フォルダー|작업 폴더|Folder roboczy|Pasta de trabalho|Рабочая папка
数据与备份|資料與備份|Daten und Sicherungen|Datos y copias de seguridad|Données et sauvegardes|Dati e backup|データとバックアップ|데이터 및 백업|Dane i kopie zapasowe|Dados e backups|Данные и резервные копии
练习历史|練習歷史|Übungsverlauf|Historial de práctica|Historique d’entraînement|Cronologia esercizi|練習履歴|연습 기록|Historia ćwiczeń|Histórico de prática|История упражнений
插件|外掛|Erweiterungen|Complementos|Extensions|Estensioni|プラグイン|플러그인|Wtyczki|Plugins|Плагины
设置|設定|Einstellungen|Ajustes|Paramètres|Impostazioni|設定|설정|Ustawienia|Configurações|Настройки
帮助|說明|Hilfe|Ayuda|Aide|Aiuto|ヘルプ|도움말|Pomoc|Ajuda|Справка
展开侧栏|展開側欄|Seitenleiste ausklappen|Expandir barra lateral|Déployer la barre latérale|Espandi barra laterale|サイドバーを展開|사이드바 펼치기|Rozwiń pasek boczny|Expandir barra lateral|Развернуть боковую панель
收起侧栏|收合側欄|Seitenleiste einklappen|Contraer barra lateral|Réduire la barre latérale|Comprimi barra laterale|サイドバーを折りたたむ|사이드바 접기|Zwiń pasek boczny|Recolher barra lateral|Свернуть боковую панель
通用|一般|Allgemein|General|Général|Generali|一般|일반|Ogólne|Geral|Общие
界面|介面|Darstellung|Apariencia|Apparence|Aspetto|外観|화면|Wygląd|Aparência|Внешний вид
偏好语言|偏好語言|Bevorzugte Sprache|Idioma preferido|Langue préférée|Lingua preferita|使用する言語|선호 언어|Preferowany język|Idioma preferido|Предпочитаемый язык
语言|語言|Sprache|Idioma|Langue|Lingua|言語|언어|Język|Idioma|Язык
界面语言|介面語言|Oberflächensprache|Idioma de la interfaz|Langue de l’interface|Lingua dell’interfaccia|表示言語|화면 언어|Język interfejsu|Idioma da interface|Язык интерфейса
颜色模式|色彩模式|Farbmodus|Modo de color|Mode de couleur|Modalità colore|カラーモード|색상 모드|Tryb kolorów|Modo de cor|Цветовой режим
跟随系统|跟隨系統|Systemeinstellung|Seguir el sistema|Suivre le système|Segui il sistema|システムに合わせる|시스템 설정 따르기|Zgodnie z systemem|Seguir o sistema|Как в системе
浅色|淺色|Hell|Claro|Clair|Chiaro|ライト|밝게|Jasny|Claro|Светлый
深色|深色|Dunkel|Oscuro|Sombre|Scuro|ダーク|어둡게|Ciemny|Escuro|Тёмный
学习|學習|Lernen|Estudio|Étude|Studio|学習|학습|Nauka|Estudo|Обучение
快捷键与鼠标手势|快捷鍵與滑鼠手勢|Tastenkürzel und Mausgesten|Atajos y gestos del ratón|Raccourcis et gestes de la souris|Scorciatoie e gesti del mouse|ショートカットとマウスジェスチャー|단축키 및 마우스 제스처|Skróty i gesty myszy|Atalhos e gestos do mouse|Сочетания клавиш и жесты мыши
系统默认|系統預設|Systemstandard|Predeterminado del sistema|Par défaut du système|Predefinito di sistema|システム既定|시스템 기본값|Domyślne systemu|Padrão do sistema|По умолчанию в системе
通知|通知|Benachrichtigungen|Notificaciones|Notifications|Notifiche|通知|알림|Powiadomienia|Notificações|Уведомления
弹出通知|彈出通知|Pop-up-Benachrichtigungen|Notificaciones emergentes|Notifications contextuelles|Notifiche a comparsa|ポップアップ通知|팝업 알림|Powiadomienia wyskakujące|Notificações pop-up|Всплывающие уведомления
信息通知|資訊通知|Informationen|Información|Informations|Informazioni|情報|정보|Informacje|Informações|Информация
警告通知|警告通知|Warnungen|Advertencias|Avertissements|Avvisi|警告|경고|Ostrzeżenia|Avisos|Предупреждения
错误通知|錯誤通知|Fehler|Errores|Erreurs|Errori|エラー|오류|Błędy|Erros|Ошибки
连接|連線|Verbindungen|Conexiones|Connexions|Connessioni|接続|연결|Połączenia|Conexões|Подключения
工具|工具|Werkzeuge|Herramientas|Outils|Strumenti|ツール|도구|Narzędzia|Ferramentas|Инструменты
复习|複習|Wiederholen|Repasar|Réviser|Ripasso|復習|복습|Powtórka|Revisar|Повторение
搜索|搜尋|Suchen|Buscar|Rechercher|Cerca|検索|검색|Szukaj|Pesquisar|Поиск
保存|儲存|Speichern|Guardar|Enregistrer|Salva|保存|저장|Zapisz|Salvar|Сохранить
取消|取消|Abbrechen|Cancelar|Annuler|Annulla|キャンセル|취소|Anuluj|Cancelar|Отмена
关闭|關閉|Schließen|Cerrar|Fermer|Chiudi|閉じる|닫기|Zamknij|Fechar|Закрыть
添加|新增|Hinzufügen|Añadir|Ajouter|Aggiungi|追加|추가|Dodaj|Adicionar|Добавить
编辑|編輯|Bearbeiten|Editar|Modifier|Modifica|編集|편집|Edytuj|Editar|Изменить
删除|刪除|Löschen|Eliminar|Supprimer|Elimina|削除|삭제|Usuń|Excluir|Удалить
返回|返回|Zurück|Volver|Retour|Indietro|戻る|돌아가기|Wstecz|Voltar|Назад
上一页|上一頁|Zurück|Anterior|Précédent|Precedente|前のページ|이전 페이지|Poprzednia|Anterior|Предыдущая
下一页|下一頁|Weiter|Siguiente|Suivant|Successiva|次のページ|다음 페이지|Następna|Próxima|Следующая
更多操作|更多操作|Weitere Aktionen|Más acciones|Autres actions|Altre azioni|その他の操作|더 많은 작업|Więcej działań|Mais ações|Другие действия
加载更多|載入更多|Mehr laden|Cargar más|Charger davantage|Carica altro|さらに読み込む|더 불러오기|Wczytaj więcej|Carregar mais|Загрузить ещё
正在加载…|正在載入…|Wird geladen…|Cargando…|Chargement…|Caricamento…|読み込み中…|불러오는 중…|Wczytywanie…|Carregando…|Загрузка…
正在保存…|正在儲存…|Wird gespeichert…|Guardando…|Enregistrement…|Salvataggio…|保存中…|저장 중…|Zapisywanie…|Salvando…|Сохранение…
已删除|已刪除|Gelöscht|Eliminado|Supprimé|Eliminato|削除しました|삭제됨|Usunięto|Excluído|Удалено
设置已保存|設定已儲存|Einstellungen gespeichert|Ajustes guardados|Paramètres enregistrés|Impostazioni salvate|設定を保存しました|설정이 저장되었습니다|Ustawienia zapisane|Configurações salvas|Настройки сохранены
设置未能保存，请重试。|無法儲存設定，請重試。|Einstellungen konnten nicht gespeichert werden. Bitte erneut versuchen.|No se pudieron guardar los ajustes. Inténtalo de nuevo.|Impossible d’enregistrer les paramètres. Réessayez.|Impossibile salvare le impostazioni. Riprova.|設定を保存できませんでした。もう一度お試しください。|설정을 저장하지 못했습니다. 다시 시도해 주세요.|Nie udało się zapisać ustawień. Spróbuj ponownie.|Não foi possível salvar as configurações. Tente novamente.|Не удалось сохранить настройки. Повторите попытку.
我的卡组|我的牌組|Meine Stapel|Mis mazos|Mes paquets|I miei mazzi|自分のデッキ|내 덱|Moje talie|Meus baralhos|Мои колоды
当前卡组|目前牌組|Aktueller Stapel|Mazo actual|Paquet actuel|Mazzo attuale|現在のデッキ|현재 덱|Bieżąca talia|Baralho atual|Текущая колода
新建卡组|新增牌組|Neuer Stapel|Nuevo mazo|Nouveau paquet|Nuovo mazzo|新しいデッキ|새 덱|Nowa talia|Novo baralho|Новая колода
创建卡组|建立牌組|Stapel erstellen|Crear mazo|Créer un paquet|Crea mazzo|デッキを作成|덱 만들기|Utwórz talię|Criar baralho|Создать колоду
编辑卡组|編輯牌組|Stapel bearbeiten|Editar mazo|Modifier le paquet|Modifica mazzo|デッキを編集|덱 편집|Edytuj talię|Editar baralho|Изменить колоду
删除卡组|刪除牌組|Stapel löschen|Eliminar mazo|Supprimer le paquet|Elimina mazzo|デッキを削除|덱 삭제|Usuń talię|Excluir baralho|Удалить колоду
卡组名称|牌組名稱|Stapelname|Nombre del mazo|Nom du paquet|Nome del mazzo|デッキ名|덱 이름|Nazwa talii|Nome do baralho|Название колоды
描述|說明|Beschreibung|Descripción|Description|Descrizione|説明|설명|Opis|Descrição|Описание
保存卡组|儲存牌組|Stapel speichern|Guardar mazo|Enregistrer le paquet|Salva mazzo|デッキを保存|덱 저장|Zapisz talię|Salvar baralho|Сохранить колоду
暂无卡组|尚無牌組|Noch keine Stapel|Aún no hay mazos|Aucun paquet|Nessun mazzo|デッキはまだありません|아직 덱이 없습니다|Brak talii|Nenhum baralho ainda|Колод пока нет
添加卡片|新增卡片|Karte hinzufügen|Añadir tarjeta|Ajouter une carte|Aggiungi scheda|カードを追加|카드 추가|Dodaj fiszkę|Adicionar cartão|Добавить карточку
保存卡片|儲存卡片|Karte speichern|Guardar tarjeta|Enregistrer la carte|Salva scheda|カードを保存|카드 저장|Zapisz fiszkę|Salvar cartão|Сохранить карточку
保存并继续|儲存並繼續|Speichern und weitere hinzufügen|Guardar y añadir otra|Enregistrer et continuer|Salva e aggiungi un’altra|保存して次を追加|저장하고 계속 추가|Zapisz i dodaj kolejną|Salvar e adicionar outro|Сохранить и добавить ещё
卡片|卡片|Karten|Tarjetas|Cartes|Schede|カード|카드|Fiszki|Cartões|Карточки
卡组|牌組|Stapel|Mazo|Paquet|Mazzo|デッキ|덱|Talia|Baralho|Колода
状态|狀態|Status|Estado|État|Stato|状態|상태|Stan|Estado|Состояние
操作|操作|Aktionen|Acciones|Actions|Azioni|操作|작업|Działania|Ações|Действия
问题|問題|Frage|Pregunta|Question|Domanda|問題|질문|Pytanie|Pergunta|Вопрос
答案|答案|Antwort|Respuesta|Réponse|Risposta|答え|답변|Odpowiedź|Resposta|Ответ
标签|標籤|Schlagwörter|Etiquetas|Étiquettes|Etichette|タグ|태그|Tagi|Etiquetas|Метки
输入问题|輸入問題|Frage eingeben|Escribe la pregunta|Saisir la question|Inserisci la domanda|問題を入力|질문 입력|Wpisz pytanie|Digite a pergunta|Введите вопрос
补充说明|補充說明|Zusätzliche Informationen|Información adicional|Informations complémentaires|Informazioni aggiuntive|補足情報|추가 설명|Dodatkowe informacje|Informações adicionais|Дополнительная информация
挖空答案|填空答案|Lückentext|Texto omitido|Texte masqué|Testo mancante|穴埋めの答え|빈칸 답변|Brakujący tekst|Texto omitido|Пропущенный текст
全部卡组|全部牌組|Alle Stapel|Todos los mazos|Tous les paquets|Tutti i mazzi|すべてのデッキ|모든 덱|Wszystkie talie|Todos os baralhos|Все колоды
全部状态|全部狀態|Alle Status|Todos los estados|Tous les états|Tutti gli stati|すべての状態|모든 상태|Wszystkie stany|Todos os estados|Все состояния
筛选卡组|篩選牌組|Nach Stapel filtern|Filtrar por mazo|Filtrer par paquet|Filtra per mazzo|デッキで絞り込み|덱으로 필터링|Filtruj według talii|Filtrar por baralho|Фильтр по колоде
筛选状态|篩選狀態|Nach Status filtern|Filtrar por estado|Filtrer par état|Filtra per stato|状態で絞り込み|상태로 필터링|Filtruj według stanu|Filtrar por estado|Фильтр по состоянию
开始复习|開始複習|Wiederholung starten|Iniciar repaso|Commencer la révision|Inizia ripasso|復習を開始|복습 시작|Rozpocznij powtórkę|Iniciar revisão|Начать повторение
显示答案|顯示答案|Antwort anzeigen|Mostrar respuesta|Afficher la réponse|Mostra risposta|答えを表示|답변 보기|Pokaż odpowiedź|Mostrar resposta|Показать ответ
结束复习|結束複習|Wiederholung beenden|Terminar repaso|Terminer la révision|Termina ripasso|復習を終了|복습 종료|Zakończ powtórkę|Encerrar revisão|Завершить повторение
结束专项练习|結束專項練習|Übung beenden|Terminar práctica|Terminer l’entraînement|Termina esercizio|練習を終了|연습 종료|Zakończ ćwiczenie|Encerrar prática|Завершить упражнение
重来|重來|Nochmal|Otra vez|À revoir|Da ripetere|もう一度|다시|Jeszcze raz|Repetir|Снова
困难|困難|Schwer|Difícil|Difficile|Difficile|難しい|어려움|Trudne|Difícil|Трудно
良好|良好|Gut|Bien|Bien|Bene|普通|보통|Dobrze|Bom|Хорошо
简单|簡單|Einfach|Fácil|Facile|Facile|簡単|쉬움|Łatwe|Fácil|Легко
撤销上次评分|復原上次評分|Letzte Bewertung rückgängig|Deshacer última valoración|Annuler la dernière évaluation|Annulla ultima valutazione|前の評価を取り消す|마지막 평가 취소|Cofnij ostatnią ocenę|Desfazer última avaliação|Отменить последнюю оценку
今天暂缓|今天暫緩|Für heute zurückstellen|Posponer por hoy|Reporter à demain|Rimanda per oggi|今日は保留|오늘은 미루기|Odłóż na dziś|Adiar por hoje|Отложить на сегодня
暂停此卡|暫停此卡|Karte aussetzen|Suspender tarjeta|Suspendre la carte|Sospendi scheda|カードを停止|카드 일시 중지|Wstrzymaj fiszkę|Suspender cartão|Приостановить карточку
新卡片|新卡片|Neu|Nueva|Nouvelle|Nuova|新規カード|새 카드|Nowa|Novo|Новая
复习卡片|複習卡片|Karte wiederholen|Tarjeta de repaso|Carte à réviser|Scheda da ripassare|復習カード|복습 카드|Fiszka do powtórki|Cartão de revisão|Карточка для повторения
根据回答情况评分|根據回答情況評分|Antwort bewerten|Valora tu respuesta|Évaluez votre réponse|Valuta la risposta|回答を評価|답변 평가|Oceń odpowiedź|Avalie sua resposta|Оцените ответ
本轮复习结束|本輪複習結束|Wiederholung abgeschlossen|Repaso terminado|Révision terminée|Ripasso completato|今回の復習は終了です|이번 복습이 끝났습니다|Powtórka zakończona|Revisão concluída|Повторение завершено
本轮练习结束|本輪練習結束|Übung abgeschlossen|Práctica terminada|Entraînement terminé|Esercizio completato|今回の練習は終了です|이번 연습이 끝났습니다|Ćwiczenie zakończone|Prática concluída|Упражнение завершено
暂无待复习卡片|目前沒有待複習卡片|Keine fälligen Karten|No hay tarjetas pendientes|Aucune carte à réviser|Nessuna scheda in scadenza|復習するカードはありません|복습할 카드가 없습니다|Brak fiszek do powtórki|Nenhum cartão para revisar|Нет карточек для повторения
已达到今日上限|已達今日上限|Tageslimit erreicht|Límite diario alcanzado|Limite quotidienne atteinte|Limite giornaliero raggiunto|今日の上限に達しました|오늘의 한도에 도달했습니다|Osiągnięto dzienny limit|Limite diário atingido|Достигнут дневной лимит
复习记录|複習紀錄|Wiederholungsverlauf|Historial de repasos|Historique des révisions|Cronologia ripassi|復習履歴|복습 기록|Historia powtórek|Histórico de revisões|История повторений
材料标题|材料標題|Materialtitel|Título del material|Titre du document|Titolo del materiale|資料のタイトル|자료 제목|Tytuł materiału|Título do material|Название материала
搜索标题|搜尋標題|Titel suchen|Buscar títulos|Rechercher des titres|Cerca titoli|タイトルを検索|제목 검색|Szukaj tytułów|Pesquisar títulos|Поиск по названию
下一篇|下一篇|Nächstes Material|Siguiente material|Document suivant|Materiale successivo|次の資料|다음 자료|Następny materiał|Próximo material|Следующий материал
还没有学习材料|尚無學習材料|Noch keine Materialien|Aún no hay materiales|Aucun document d’étude|Nessun materiale di studio|学習資料はまだありません|아직 학습 자료가 없습니다|Brak materiałów do nauki|Nenhum material de estudo ainda|Учебных материалов пока нет
导出原件|匯出原件|Original exportieren|Exportar original|Exporter l’original|Esporta originale|原本をエクスポート|원본 내보내기|Eksportuj oryginał|Exportar original|Экспортировать оригинал
查看文本副本|檢視文字副本|Textkopie anzeigen|Ver copia de texto|Voir la copie texte|Mostra copia testuale|テキストのコピーを表示|텍스트 사본 보기|Wyświetl kopię tekstową|Ver cópia de texto|Показать текстовую копию
材料已保存|材料已儲存|Material gespeichert|Material guardado|Document enregistré|Materiale salvato|資料を保存しました|자료가 저장되었습니다|Materiał zapisany|Material salvo|Материал сохранён
材料已删除|材料已刪除|Material gelöscht|Material eliminado|Document supprimé|Materiale eliminato|資料を削除しました|자료가 삭제되었습니다|Materiał usunięty|Material excluído|Материал удалён
导入预览|匯入預覽|Importvorschau|Vista previa de importación|Aperçu de l’importation|Anteprima importazione|インポートのプレビュー|가져오기 미리보기|Podgląd importu|Prévia da importação|Предпросмотр импорта
确认导入|確認匯入|Import bestätigen|Confirmar importación|Confirmer l’importation|Conferma importazione|インポートを確定|가져오기 확인|Potwierdź import|Confirmar importação|Подтвердить импорт
批量导入|批次匯入|Stapelimport|Importación masiva|Importation groupée|Importazione in blocco|一括インポート|일괄 가져오기|Import zbiorczy|Importação em lote|Массовый импорт
导出备份|匯出備份|Sicherung exportieren|Exportar copia de seguridad|Exporter la sauvegarde|Esporta backup|バックアップをエクスポート|백업 내보내기|Eksportuj kopię zapasową|Exportar backup|Экспортировать резервную копию
恢复备份|還原備份|Sicherung wiederherstellen|Restaurar copia de seguridad|Restaurer une sauvegarde|Ripristina backup|バックアップを復元|백업 복원|Przywróć kopię zapasową|Restaurar backup|Восстановить резервную копию
自动备份|自動備份|Automatische Sicherung|Copia automática|Sauvegarde automatique|Backup automatico|自動バックアップ|자동 백업|Automatyczna kopia zapasowa|Backup automático|Автоматическое резервирование
确认删除|確認刪除|Löschen bestätigen|Confirmar eliminación|Confirmer la suppression|Conferma eliminazione|削除を確認|삭제 확인|Potwierdź usunięcie|Confirmar exclusão|Подтвердить удаление
插件信息|外掛資訊|Erweiterungsinformationen|Información del complemento|Informations sur l’extension|Informazioni estensione|プラグイン情報|플러그인 정보|Informacje o wtyczce|Informações do plugin|Информация о плагине
已启用|已啟用|Aktiviert|Activado|Activée|Attivata|有効|사용 중|Włączona|Ativado|Включён
未启用|未啟用|Deaktiviert|Desactivado|Désactivée|Disattivata|無効|사용 안 함|Wyłączona|Desativado|Выключен
重新加载页面|重新載入頁面|Seite neu laden|Recargar página|Recharger la page|Ricarica pagina|ページを再読み込み|페이지 새로고침|Odśwież stronę|Recarregar página|Перезагрузить страницу
快捷键|快捷鍵|Tastenkürzel|Atajos de teclado|Raccourcis clavier|Scorciatoie da tastiera|キーボードショートカット|키보드 단축키|Skróty klawiszowe|Atalhos de teclado|Сочетания клавиш
鼠标手势|滑鼠手勢|Mausgesten|Gestos del ratón|Gestes de la souris|Gesti del mouse|マウスジェスチャー|마우스 제스처|Gesty myszy|Gestos do mouse|Жесты мыши
启用鼠标手势|啟用滑鼠手勢|Mausgesten aktivieren|Activar gestos del ratón|Activer les gestes de la souris|Attiva gesti del mouse|マウスジェスチャーを有効化|마우스 제스처 사용|Włącz gesty myszy|Ativar gestos do mouse|Включить жесты мыши
搜索命令|搜尋命令|Befehl suchen|Buscar comando|Rechercher une commande|Cerca comando|コマンドを検索|명령 검색|Szukaj polecenia|Pesquisar comando|Поиск команды
录制快捷键|錄製快捷鍵|Tastenkürzel aufzeichnen|Grabar atajo|Enregistrer un raccourci|Registra scorciatoia|ショートカットを記録|단축키 기록|Nagraj skrót|Gravar atalho|Записать сочетание
恢复默认|恢復預設|Standard wiederherstellen|Restaurar predeterminado|Rétablir la valeur par défaut|Ripristina predefinito|既定に戻す|기본값 복원|Przywróć domyślne|Restaurar padrão|Восстановить по умолчанию
取消绑定|取消綁定|Zuordnung entfernen|Quitar asignación|Supprimer l’affectation|Rimuovi associazione|割り当てを解除|연결 해제|Usuń przypisanie|Remover associação|Снять назначение
未绑定|未綁定|Nicht zugewiesen|Sin asignar|Non affecté|Non assegnato|未割り当て|지정되지 않음|Nieprzypisany|Não associado|Не назначено
快捷键冲突|快捷鍵衝突|Tastenkürzelkonflikt|Conflicto de atajo|Conflit de raccourci|Conflitto di scorciatoia|ショートカットの競合|단축키 충돌|Konflikt skrótu|Conflito de atalho|Конфликт сочетаний
菜单与工具栏|選單與工具列|Menüs und Werkzeugleisten|Menús y barras de herramientas|Menus et barres d’outils|Menu e barre degli strumenti|メニューとツールバー|메뉴 및 도구 모음|Menu i paski narzędzi|Menus e barras de ferramentas|Меню и панели инструментов
阅读与外观|閱讀與外觀|Lesen und Darstellung|Lectura y apariencia|Lecture et apparence|Lettura e aspetto|読書と外観|읽기 및 외관|Czytanie i wygląd|Leitura e aparência|Чтение и внешний вид
侧栏与布局|側欄與版面|Seitenleiste und Layout|Barra lateral y diseño|Barre latérale et disposition|Barra laterale e disposizione|サイドバーとレイアウト|사이드바 및 레이아웃|Pasek boczny i układ|Barra lateral e layout|Боковая панель и компоновка
阅读排版|閱讀排版|Lesetypografie|Tipografía de lectura|Typographie de lecture|Tipografia di lettura|読書の文字設定|읽기 서식|Typografia czytania|Tipografia de leitura|Оформление текста
界面字体|介面字型|Oberflächenschrift|Fuente de la interfaz|Police de l’interface|Carattere dell’interfaccia|画面のフォント|인터페이스 글꼴|Czcionka interfejsu|Fonte da interface|Шрифт интерфейса
阅读字体|閱讀字型|Leseschrift|Fuente de lectura|Police de lecture|Carattere di lettura|読書用フォント|읽기 글꼴|Czcionka tekstu|Fonte de leitura|Шрифт для чтения
等宽字体|等寬字型|Monospace-Schrift|Fuente monoespaciada|Police à chasse fixe|Carattere monospazio|等幅フォント|고정폭 글꼴|Czcionka o stałej szerokości|Fonte monoespaçada|Моноширинный шрифт
界面缩放|介面縮放|Oberflächenskalierung|Escala de la interfaz|Échelle de l’interface|Scala dell’interfaccia|画面の拡大率|인터페이스 배율|Skala interfejsu|Escala da interface|Масштаб интерфейса
正文字号|正文字級|Textgröße|Tamaño del texto|Taille du texte|Dimensione del testo|本文の文字サイズ|본문 글자 크기|Rozmiar tekstu|Tamanho do texto|Размер текста
阅读行宽|閱讀行寬|Lesebreite|Ancho de lectura|Largeur de lecture|Larghezza di lettura|本文の幅|본문 너비|Szerokość tekstu|Largura de leitura|Ширина текста
阅读行高|閱讀行高|Zeilenhöhe|Altura de línea|Hauteur de ligne|Altezza della riga|行の高さ|줄 높이|Wysokość wiersza|Altura da linha|Межстрочный интервал
段落间距|段落間距|Absatzabstand|Espacio entre párrafos|Espacement des paragraphes|Spaziatura dei paragrafi|段落の間隔|문단 간격|Odstęp między akapitami|Espaço entre parágrafos|Интервал между абзацами
配色|配色|Farben|Colores|Couleurs|Colori|配色|색상|Kolory|Cores|Цвета
强调色|強調色|Akzentfarbe|Color de acento|Couleur d’accent|Colore principale|アクセントカラー|강조 색상|Kolor akcentu|Cor de destaque|Акцентный цвет
页面背景|頁面背景|Seitenhintergrund|Fondo de página|Arrière-plan de la page|Sfondo della pagina|ページの背景|페이지 배경|Tło strony|Fundo da página|Фон страницы
内容背景|內容背景|Inhaltshintergrund|Fondo del contenido|Arrière-plan du contenu|Sfondo del contenuto|コンテンツの背景|콘텐츠 배경|Tło treści|Fundo do conteúdo|Фон содержимого
减少动态效果|減少動態效果|Bewegung reduzieren|Reducir movimiento|Réduire les animations|Riduci animazioni|動きを減らす|동작 줄이기|Ogranicz animacje|Reduzir movimento|Уменьшить анимацию
阅读与辅助功能|閱讀與輔助功能|Lesen und Barrierefreiheit|Lectura y accesibilidad|Lecture et accessibilité|Lettura e accessibilità|読書とアクセシビリティ|읽기 및 접근성|Czytanie i dostępność|Leitura e acessibilidade|Чтение и специальные возможности
应用|套用|Anwenden|Aplicar|Appliquer|Applica|適用|적용|Zastosuj|Aplicar|Применить
舒适|舒適|Komfortabel|Cómodo|Confortable|Comoda|ゆったり|넉넉하게|Wygodny|Confortável|Удобная
紧凑|精簡|Kompakt|Compacto|Compacte|Compatta|コンパクト|촘촘하게|Zwarty|Compacto|Компактная
历史|歷史|Verlauf|Historial|Historique|Cronologia|履歴|기록|Historia|Histórico|История
图标|圖示|Symbol|Icono|Icône|Icona|アイコン|아이콘|Ikona|Ícone|Значок
未安排|未安排|Nicht geplant|Sin programar|Non planifié|Non programmato|未予定|예정 없음|Niezaplanowane|Não programado|Не запланировано
已安排|已安排|Geplant|Programado|Planifié|Programmato|予定済み|예정됨|Zaplanowane|Programado|Запланировано
已归档|已封存|Archiviert|Archivado|Archivé|Archiviato|アーカイブ済み|보관됨|Zarchiwizowane|Arquivado|В архиве
应用更新|應用程式更新|Anwendungsupdates|Actualizaciones de la aplicación|Mises à jour de l’application|Aggiornamenti applicazione|アプリの更新|앱 업데이트|Aktualizacje aplikacji|Atualizações do aplicativo|Обновления приложения
检查更新|檢查更新|Nach Updates suchen|Buscar actualizaciones|Rechercher des mises à jour|Verifica aggiornamenti|更新を確認|업데이트 확인|Sprawdź aktualizacje|Verificar atualizações|Проверить обновления
发现新版本|發現新版本|Neue Version verfügbar|Nueva versión disponible|Nouvelle version disponible|Nuova versione disponibile|新しいバージョンがあります|새 버전이 있습니다|Dostępna nowa wersja|Nova versão disponível|Доступна новая версия
反馈问题|回報問題|Problem melden|Informar de un problema|Signaler un problème|Segnala un problema|問題を報告|문제 신고|Zgłoś problem|Relatar um problema|Сообщить о проблеме
最小化窗口|最小化視窗|Fenster minimieren|Minimizar ventana|Réduire la fenêtre|Riduci a icona|ウィンドウを最小化|창 최소화|Minimalizuj okno|Minimizar janela|Свернуть окно
最大化窗口|最大化視窗|Fenster maximieren|Maximizar ventana|Agrandir la fenêtre|Ingrandisci finestra|ウィンドウを最大化|창 최대화|Maksymalizuj okno|Maximizar janela|Развернуть окно
还原窗口|還原視窗|Fenster wiederherstellen|Restaurar ventana|Restaurer la fenêtre|Ripristina finestra|ウィンドウを元に戻す|창 복원|Przywróć okno|Restaurar janela|Восстановить окно
关闭窗口|關閉視窗|Fenster schließen|Cerrar ventana|Fermer la fenêtre|Chiudi finestra|ウィンドウを閉じる|창 닫기|Zamknij okno|Fechar janela|Закрыть окно
语言与翻译|語言與翻譯|Sprache und Übersetzungen|Idioma y traducciones|Langue et traductions|Lingua e traduzioni|言語と翻訳|언어 및 번역|Język i tłumaczenia|Idioma e traduções|Язык и переводы
导入语言包|匯入語言套件|Sprachpaket importieren|Importar paquete de idioma|Importer un pack de langue|Importa pacchetto lingua|言語パックをインポート|언어 팩 가져오기|Importuj pakiet językowy|Importar pacote de idioma|Импортировать языковой пакет
导出语言包|匯出語言套件|Sprachpaket exportieren|Exportar paquete de idioma|Exporter un pack de langue|Esporta pacchetto lingua|言語パックをエクスポート|언어 팩 내보내기|Eksportuj pakiet językowy|Exportar pacote de idioma|Экспортировать языковой пакет
未翻译的条目使用英文。可导出语言包补充译文，再导入到当前学习库；不会翻译或修改学习内容。|未翻譯的項目會顯示英文。可匯出語言套件補充譯文，再匯入目前學習庫；不會翻譯或修改學習內容。|Nicht übersetzte Texte erscheinen auf Englisch. Exportieren Sie ein Sprachpaket, ergänzen Sie Übersetzungen und importieren Sie es in diese Bibliothek. Lerninhalte werden nicht übersetzt oder geändert.|Los textos sin traducir se muestran en inglés. Exporta un paquete de idioma, completa las traducciones e impórtalo en esta biblioteca. El contenido de estudio no se traduce ni se modifica.|Les textes non traduits s’affichent en anglais. Exportez un pack de langue, complétez les traductions et importez-le dans cette bibliothèque. Le contenu d’étude n’est ni traduit ni modifié.|I testi non tradotti vengono mostrati in inglese. Esporta un pacchetto lingua, completa le traduzioni e importalo nella biblioteca. I contenuti di studio non vengono tradotti o modificati.|未翻訳の項目は英語で表示されます。言語パックをエクスポートして翻訳を追加し、このライブラリにインポートできます。学習内容は翻訳・変更されません。|번역되지 않은 항목은 영어로 표시됩니다. 언어 팩을 내보내 번역을 추가한 뒤 현재 라이브러리에 가져올 수 있습니다. 학습 내용은 번역하거나 변경하지 않습니다.|Nieprzetłumaczone teksty są wyświetlane po angielsku. Wyeksportuj pakiet językowy, dodaj tłumaczenia i zaimportuj go do tej biblioteki. Materiały do nauki nie są tłumaczone ani zmieniane.|Os textos não traduzidos são exibidos em inglês. Exporte um pacote de idioma, adicione traduções e importe-o nesta biblioteca. O conteúdo de estudo não é traduzido nem alterado.|Непереведённые строки отображаются на английском. Экспортируйте языковой пакет, добавьте переводы и импортируйте его в эту библиотеку. Учебные материалы не переводятся и не изменяются.
今日已复习 {count} 次|今日已複習 {count} 次|Heute {count} Wiederholungen|{count} repasos hoy|{count} révisions aujourd’hui|{count} ripassi oggi|今日の復習 {count} 回|오늘 복습 {count}회|Powtórki dzisiaj: {count}|{count} revisões hoje|Повторений сегодня: {count}
已复习 {p0} 次 · 当前待学 {p1} 张|已複習 {p0} 次 · 目前待學 {p1} 張|Wiederholt: {p0} · Verbleibend: {p1}|Repasadas: {p0} · Pendientes: {p1}|Révisées : {p0} · Restantes : {p1}|Ripassate: {p0} · Rimanenti: {p1}|復習済み {p0} 回 · 残り {p1} 枚|복습 {p0}회 · 남은 카드 {p1}개|Powtórzono: {p0} · Pozostało: {p1}|Revisados: {p0} · Restantes: {p1}|Повторено: {p0} · Осталось: {p1}
`
  .trim()
  .split('\n')
  .map((row) => row.split('|'))

export const interfaceMessageKeys = labels.map(([key]) => key!)
export const interfaceCatalogs: TranslationCatalogs = Object.fromEntries(
  interfaceLocales.map((language, index) => [
    language,
    Object.fromEntries(labels.map((row) => [row[0]!, row[index + 1]!])),
  ]),
)
